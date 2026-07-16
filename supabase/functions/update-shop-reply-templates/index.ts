import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { createCallerClient, createServiceClient } from "../_shared/supabaseClients.ts";
import { AuthzError, requireAdmin } from "../_shared/requireAdmin.ts";
import {
  REPLY_TEMPLATE_KEYS,
  REPLY_TEMPLATE_MAX_LENGTH,
  parseReplyTemplates,
  type ReplyTemplateKey,
} from "../_shared/replyTemplates.ts";

// `shops` is only writable by super_admin under RLS, so this is the sanctioned
// path for a shop admin to reword their own bot replies.
//
// Deliberately its own function rather than another field on
// `update-shop-ai-settings`: that one writes `openai_api_key` unconditionally
// from its body, so folding templates in would mean every "save my reply text"
// (with the write-only key field left blank, as it always is) silently cleared
// the shop's OpenAI key and took the whole chatbot down.

const VALID_KEYS = new Set<string>(REPLY_TEMPLATE_KEYS);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const { reply_templates } = body as { reply_templates?: unknown };

    if (!reply_templates || typeof reply_templates !== "object" || Array.isArray(reply_templates)) {
      return jsonResponse({ error: "reply_templates must be an object" }, { status: 400 });
    }

    // Reject unknown keys rather than storing them: the column would otherwise
    // accumulate junk that nothing reads, and a typo'd key would look saved
    // while the bot kept using the default — the exact "I changed it and nothing
    // happened" bug this feature exists to avoid.
    const entries = Object.entries(reply_templates as Record<string, unknown>);
    for (const [key, value] of entries) {
      if (!VALID_KEYS.has(key)) {
        return jsonResponse({ error: `Unknown reply template: ${key}` }, { status: 400 });
      }
      if (value !== null && typeof value !== "string") {
        return jsonResponse({ error: `${key} must be a string, or null to reset it` }, { status: 400 });
      }
      if (typeof value === "string" && value.length > REPLY_TEMPLATE_MAX_LENGTH) {
        return jsonResponse(
          { error: `${key} must be ${REPLY_TEMPLATE_MAX_LENGTH} characters or fewer` },
          { status: 400 }
        );
      }
    }

    const caller = createCallerClient(req.headers.get("Authorization"));
    const { shopId } = await requireAdmin(caller);

    const service = createServiceClient();

    // Merge rather than replace. The settings form does send the full set, but
    // this keeps a partial call (one key at a time) from silently resetting every
    // other sentence to its default.
    const { data: shop, error: readError } = await service
      .from("shops")
      .select("reply_templates")
      .eq("id", shopId)
      .single();
    if (readError || !shop) {
      return jsonResponse({ error: readError?.message ?? "Shop not found" }, { status: 404 });
    }

    const next = parseReplyTemplates(shop.reply_templates) as Record<string, string>;
    for (const [key, value] of entries) {
      const trimmed = typeof value === "string" ? value.trim() : null;
      // Blank means "reset this one" — drop the key so the resolver falls back to
      // the system default, instead of storing "" and muting the bot.
      if (trimmed === null || trimmed === "") {
        delete next[key];
      } else {
        next[key as ReplyTemplateKey] = trimmed;
      }
    }

    const { data: updated, error } = await service
      .from("shops")
      .update({ reply_templates: next })
      .eq("id", shopId)
      .select("reply_templates")
      .single();
    if (error || !updated) {
      return jsonResponse({ error: error?.message ?? "Failed to save" }, { status: 500 });
    }

    return jsonResponse({ reply_templates: updated.reply_templates });
  } catch (error) {
    if (error instanceof AuthzError) {
      return jsonResponse({ error: error.message }, { status: error.status });
    }
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
});
