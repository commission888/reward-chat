import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { createCallerClient, createServiceClient } from "../_shared/supabaseClients.ts";
import { createEmbeddings } from "../_shared/openai.ts";

const CHUNK_SIZE_WORDS = 600; // rough proxy for ~500-800 tokens
const CHUNK_OVERLAP_WORDS = 100;
const EMBEDDING_BATCH_SIZE = 20;

function chunkText(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const chunks: string[] = [];
  let start = 0;
  while (start < words.length) {
    const end = Math.min(start + CHUNK_SIZE_WORDS, words.length);
    chunks.push(words.slice(start, end).join(" "));
    if (end === words.length) break;
    start = end - CHUNK_OVERLAP_WORDS;
  }
  return chunks;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let service;
  let fileId: string | undefined;

  try {
    const body = await req.json();
    const { file_id, text } = body as { file_id?: string; text?: string };
    fileId = file_id;

    if (!file_id || typeof text !== "string") {
      return jsonResponse({ error: "file_id and text are required" }, { status: 400 });
    }

    // Confirm the caller can actually see this file (RLS: shop admin only)
    // before doing any service-role work with it.
    const caller = createCallerClient(req.headers.get("Authorization"));
    const { data: file, error: fileError } = await caller
      .from("files")
      .select("id, shop_id")
      .eq("id", file_id)
      .single();
    if (fileError || !file) {
      return jsonResponse({ error: "File not found or not accessible" }, { status: 403 });
    }

    service = createServiceClient();

    // The shop pays for its own embeddings. Check before marking the file
    // "processing" so a missing key reads as "you haven't set this up" rather
    // than a file stuck mid-flight.
    const { data: shop } = await service
      .from("shops")
      .select("openai_api_key")
      .eq("id", file.shop_id)
      .single();
    if (!shop?.openai_api_key) {
      await service
        .from("files")
        .update({ status: "failed", error_message: "No OpenAI API key configured for this shop" })
        .eq("id", file_id);
      return jsonResponse(
        { error: "Add your shop's OpenAI API key in AI settings before uploading documents." },
        { status: 400 }
      );
    }

    await service.from("files").update({ status: "processing" }).eq("id", file_id);

    const chunks = chunkText(text);
    if (chunks.length === 0) {
      await service.from("files").update({ status: "failed", error_message: "No extractable text" }).eq("id", file_id);
      return jsonResponse({ error: "No extractable text in file" }, { status: 400 });
    }

    // Idempotent re-ingestion: drop any chunks from a previous run for this file.
    await service.from("document_chunks").delete().eq("file_id", file_id);

    for (let i = 0; i < chunks.length; i += EMBEDDING_BATCH_SIZE) {
      const batch = chunks.slice(i, i + EMBEDDING_BATCH_SIZE);
      const embeddings = await createEmbeddings(batch, shop.openai_api_key);
      const rows = batch.map((content, j) => ({
        shop_id: file.shop_id,
        file_id,
        chunk_index: i + j,
        content,
        embedding: embeddings[j],
        token_count: content.split(/\s+/).length,
      }));
      const { error: insertError } = await service.from("document_chunks").insert(rows);
      if (insertError) throw new Error(insertError.message);
    }

    await service.from("files").update({ status: "completed", error_message: null }).eq("id", file_id);

    return jsonResponse({ chunks: chunks.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (service && fileId) {
      await service.from("files").update({ status: "failed", error_message: message }).eq("id", fileId);
    }
    return jsonResponse({ error: message }, { status: 500 });
  }
});
