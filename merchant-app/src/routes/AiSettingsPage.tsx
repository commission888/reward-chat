import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  REPLY_TEMPLATE_DEFAULTS,
  REPLY_TEMPLATE_MAX_LENGTH,
  getFunctionErrorMessage,
  type ReplyTemplateKey,
  type ReplyTemplates,
} from "@rewardchat/shared";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/auth/AuthProvider";
import { useI18n } from "@/i18n/LanguageProvider";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type AiProvider = "openai" | "gemini";

// Per-provider chrome for the key card: where to get a key, and the labels/hints
// (all routed through t()). Gemini's dashboard hands out a free key.
const PROVIDER_META: Record<AiProvider, { keysUrl: string; dashKey: string }> = {
  openai: { keysUrl: "https://platform.openai.com/api-keys", dashKey: "ai.openDashboardOpenai" },
  gemini: { keysUrl: "https://aistudio.google.com/apikey", dashKey: "ai.openDashboardGemini" },
};

// Grouped for the form only — the two groups differ in a way the shop needs to
// see: chat replies come in a th/en pair because the customer's own text says
// which to use, while a slip is an image with no language signal at all.
const CHAT_KEYS: ReplyTemplateKey[] = ["chat.no_answer_th", "chat.no_answer_en"];
const SLIP_KEYS: ReplyTemplateKey[] = [
  "slip.receiver_mismatch",
  "slip.amount_mismatch",
  "slip.date_mismatch",
  "slip.not_found",
  "slip.forged",
  "slip.duplicate",
  "slip.bank_error",
  "slip.unknown",
  "slip.system_error",
];

export default function AiSettingsPage() {
  const { profile } = useAuth();
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const shopId = profile?.shop_id ?? null;
  const [key, setKey] = useState("");
  const [provider, setProvider] = useState<AiProvider>("openai");
  const providerSeeded = useRef(false);

  const { data: shop, isLoading } = useQuery({
    queryKey: ["shop-ai", shopId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shops")
        .select("ai_provider, openai_api_key, gemini_api_key, reply_templates")
        .eq("id", shopId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: Boolean(shopId),
  });

  // Seed the dropdown from the saved provider once, then leave it under the
  // user's control (a background refetch mustn't yank their selection back).
  useEffect(() => {
    if (shop && !providerSeeded.current) {
      providerSeeded.current = true;
      setProvider(shop.ai_provider === "gemini" ? "gemini" : "openai");
    }
  }, [shop]);

  // Whether the *currently selected* provider already has a stored key. Keys are
  // never echoed into the field, so this drives the badge and the placeholder.
  const configured = provider === "gemini" ? Boolean(shop?.gemini_api_key) : Boolean(shop?.openai_api_key);

  const save = useMutation({
    mutationFn: async () => {
      const trimmed = key.trim();
      const { data, error } = await supabase.functions.invoke("update-shop-ai-settings", {
        // Blank field = keep the stored key for this provider (it's write-only),
        // so send api_key only when the admin actually typed one.
        body: { ai_provider: provider, ...(trimmed === "" ? {} : { api_key: trimmed }) },
      });
      if (error) throw error;
      return data as { reingest_required?: boolean } | null;
    },
    onSuccess: (data) => {
      toast.success(t("ai.saved"));
      setKey("");
      if (data?.reingest_required) toast.warning(t("ai.reingestWarning"));
      queryClient.invalidateQueries({ queryKey: ["shop-ai", shopId] });
    },
    onError: (error) => {
      void getFunctionErrorMessage(error, t("ai.errSave")).then((m) => toast.error(m));
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("ai.title")} subtitle={t("ai.subtitle")} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {t("ai.keyTitle")}
            {!isLoading && (
              <Badge variant={configured ? "default" : "destructive"}>
                {configured ? t("ai.statusSet") : t("ai.statusMissing")}
              </Badge>
            )}
          </CardTitle>
          <CardDescription>{t("ai.keyHint")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!isLoading && !configured && (
            <p className="rounded-md bg-secondary px-4 py-3 text-sm text-foreground">{t("ai.warnMissing")}</p>
          )}
          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="ai_provider">{t("ai.providerLabel")}</Label>
              <Select value={provider} onValueChange={(v) => setProvider(v as AiProvider)}>
                <SelectTrigger id="ai_provider" className="w-full min-w-0 sm:w-72">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">{t("ai.providerOpenai")}</SelectItem>
                  <SelectItem value="gemini">{t("ai.providerGemini")}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t("ai.providerHint")}</p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="ai_api_key">{t("ai.keyLabel")}</Label>
              <Input
                id="ai_api_key"
                type="password"
                autoComplete="off"
                // The saved key is never echoed back into this field — it stays
                // write-only from the UI's side, and the badge above is how you
                // tell whether one is stored. Blank on save keeps the stored key.
                placeholder={configured ? t("ai.keyPlaceholderSet") : t("ai.keyPlaceholder")}
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t("ai.keySource")}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? t("ai.checking") : t("common.save")}
              </Button>
              <Button asChild variant="outline">
                <a href={PROVIDER_META[provider].keysUrl} target="_blank" rel="noreferrer">
                  {t(PROVIDER_META[provider].dashKey)}
                </a>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Passed straight from the query cache, not defaulted to `{}` here: react-query
          keeps one stable object per fetch, and a fresh `{}` on every render would
          retrigger the effect below it forever. */}
      <ReplyTemplatesCard shopId={shopId} saved={shop?.reply_templates as ReplyTemplates | null | undefined} />

      <Card>
        <CardHeader>
          <CardTitle>{t("ai.costTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t("ai.costBody")}</p>
        </CardContent>
      </Card>
    </div>
  );
}

type Drafts = Record<ReplyTemplateKey, string>;

// "" means "no override" throughout — it's what the box shows when the shop has
// never touched a sentence, what the save call turns into a null (reset), and
// what a shop types to undo their own edit. The grey placeholder is the default
// that will actually be sent in that case, so the box is never lying about what
// the customer gets.
function draftsFrom(saved: ReplyTemplates | null | undefined): Drafts {
  const out = {} as Drafts;
  for (const key of Object.keys(REPLY_TEMPLATE_DEFAULTS) as ReplyTemplateKey[]) {
    out[key] = saved?.[key] ?? "";
  }
  return out;
}

function ReplyTemplatesCard({
  shopId,
  saved,
}: {
  shopId: string | null;
  saved: ReplyTemplates | null | undefined;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Drafts>(() => draftsFrom(saved));

  // The card renders before the shop query resolves, so seed the boxes once the
  // saved values land. Keyed on the server value, so a save that returns
  // normalised text (trimmed) is reflected rather than leaving a stale draft.
  useEffect(() => {
    setDrafts(draftsFrom(saved));
  }, [saved]);

  const save = useMutation({
    mutationFn: async (next: Drafts) => {
      const body = Object.fromEntries(
        (Object.keys(next) as ReplyTemplateKey[]).map((key) => [key, next[key].trim() === "" ? null : next[key]])
      );
      const { error } = await supabase.functions.invoke("update-shop-reply-templates", {
        body: { reply_templates: body },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("replies.saved"));
      queryClient.invalidateQueries({ queryKey: ["shop-ai", shopId] });
    },
    onError: (error) => {
      void getFunctionErrorMessage(error, t("replies.errSave")).then((m) => toast.error(m));
    },
  });

  function field(key: ReplyTemplateKey) {
    const value = drafts[key];
    const customised = value.trim() !== "";
    return (
      <div key={key} className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor={key}>{t(`replies.${key}`)}</Label>
          <Badge variant={customised ? "default" : "secondary"}>
            {customised ? t("replies.customised") : t("replies.usingDefault")}
          </Badge>
        </div>
        <Textarea
          id={key}
          rows={2}
          maxLength={REPLY_TEMPLATE_MAX_LENGTH}
          placeholder={REPLY_TEMPLATE_DEFAULTS[key]}
          value={value}
          onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
        />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("replies.title")}</CardTitle>
        <CardDescription>{t("replies.hint")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <section className="flex flex-col gap-4">
          <div>
            <h3 className="font-medium text-foreground">{t("replies.chatGroup")}</h3>
            <p className="text-xs text-muted-foreground">{t("replies.chatGroupHint")}</p>
          </div>
          {CHAT_KEYS.map(field)}
        </section>

        <section className="flex flex-col gap-4">
          <div>
            <h3 className="font-medium text-foreground">{t("replies.slipGroup")}</h3>
            <p className="text-xs text-muted-foreground">{t("replies.slipGroupHint")}</p>
          </div>
          {SLIP_KEYS.map(field)}
        </section>

        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={save.isPending} onClick={() => save.mutate(drafts)}>
            {t("common.save")}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={save.isPending}
            onClick={() => {
              const cleared = draftsFrom({});
              setDrafts(cleared);
              save.mutate(cleared);
            }}
          >
            {t("replies.reset")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
