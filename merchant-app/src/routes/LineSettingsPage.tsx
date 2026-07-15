import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Download, ExternalLink, TriangleAlert, Upload } from "lucide-react";
import { getFunctionErrorMessage } from "@rewardchat/shared";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/auth/AuthProvider";
import { useI18n } from "@/i18n/LanguageProvider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const LINE_CONSOLE_URL = "https://developers.line.biz/console/";

// The customer LIFF app is one platform-wide deployment serving every shop (the
// shop is picked out by the ?shop_id= param), so its host is a constant here
// rather than per-shop config. The literal default matters: .env.production is
// gitignored, so without it a Vercel build with no VITE_LIFF_APP_URL set would
// quietly render "undefined" into the endpoint URL admins paste into LINE.
const LIFF_APP_BASE_URL: string =
  import.meta.env.VITE_LIFF_APP_URL ?? "https://rewardchat-liff.vercel.app";

// The whole setup collapses to this: two LINE channels, each with values you pull
// out of the console and values you push back into it. Module scope can't call
// useI18n(), so these carry key strings that render resolves.
const CHANNELS = [
  {
    titleKey: "line.guide.bot.title",
    forKey: "line.guide.bot.for",
    noteKey: "line.guide.bot.note",
    warnKey: "line.guide.bot.warn",
    pullKeys: ["line.channelId", "line.channelSecret", "line.channelAccessToken"],
    pushKeys: ["line.webhookUrl"],
  },
  {
    titleKey: "line.guide.liff.title",
    forKey: "line.guide.liff.for",
    noteKey: "line.guide.liff.note",
    warnKey: "line.guide.liff.warn",
    pullKeys: ["line.liffId"],
    pushKeys: ["line.endpointUrl"],
  },
] as const;

function CopyableUrl({ value }: { value: string }) {
  const { t } = useI18n();

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t("common.copied"));
    } catch {
      // Clipboard access needs a secure context and can be blocked outright, so
      // failure is expected enough to tell the admin to copy by hand instead.
      toast.error(t("common.copyFailed"));
    }
  }

  return (
    <div className="flex items-start gap-2">
      <code className="block flex-1 break-all rounded-md bg-muted p-3 text-sm">{value}</code>
      <Button type="button" variant="outline" size="sm" onClick={copy} aria-label={t("common.copy")}>
        <Copy />
        {t("common.copy")}
      </Button>
    </div>
  );
}

export default function LineSettingsPage() {
  const { profile } = useAuth();
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    line_channel_id: "",
    line_channel_secret: "",
    line_channel_access_token: "",
    liff_id: "",
  });

  // Seed the form from the server exactly once. A background refetch (e.g. React
  // Query's refetch-on-window-focus when the admin tabs back after copying a value
  // from the LINE console) must not clobber whatever they've typed but not saved yet.
  const seeded = useRef(false);

  const { data: shop } = useQuery({
    queryKey: ["shop", profile?.shop_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shops")
        .select("id, name, line_channel_id, line_channel_secret, line_channel_access_token, liff_id")
        .eq("id", profile!.shop_id!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: Boolean(profile?.shop_id),
  });

  useEffect(() => {
    if (shop && !seeded.current) {
      seeded.current = true;
      setForm({
        line_channel_id: shop.line_channel_id ?? "",
        line_channel_secret: shop.line_channel_secret ?? "",
        line_channel_access_token: shop.line_channel_access_token ?? "",
        liff_id: shop.liff_id ?? "",
      });
    }
  }, [shop]);

  const save = useMutation({
    mutationFn: async () => {
      // Writes to `shops` go through this edge function (service role) rather
      // than a direct client update: RLS only lets super_admin write `shops`
      // directly, so this is the admin's write path for their own LINE config.
      const { error } = await supabase.functions.invoke("update-shop-line-settings", {
        body: form,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("line.saved"));
      queryClient.invalidateQueries({ queryKey: ["shop", profile?.shop_id] });
    },
    onError: (error) => {
      void getFunctionErrorMessage(error).then((message) => toast.error(message));
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  const webhookUrl = profile?.shop_id
    ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/line-webhook/${profile.shop_id}`
    : "";

  // Built from the *saved* liff_id, not the form field: this URL is only useful
  // once the server has the ID too, and it doubles as confirmation the save landed.
  const endpointUrl =
    profile?.shop_id && shop?.liff_id
      ? `${LIFF_APP_BASE_URL}/?shop_id=${profile.shop_id}&liff_id=${shop.liff_id}`
      : "";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{t("line.title")}</h1>
        <p className="text-muted-foreground">{t("line.subtitle")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("line.guide.title")}</CardTitle>
          <CardDescription>{t("line.guide.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ol className="grid gap-4 md:grid-cols-2">
            {CHANNELS.map((channel, index) => (
              <li
                key={channel.titleKey}
                className="flex flex-col gap-3 rounded-lg border border-border p-4"
              >
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
                  >
                    {index + 1}
                  </span>
                  <p className="font-medium text-foreground">{t(channel.titleKey)}</p>
                  <Badge variant="secondary">{t(channel.forKey)}</Badge>
                </div>

                <div className="flex flex-col gap-1.5">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Download className="size-3.5" aria-hidden />
                    {t("line.guide.pull")}
                  </p>
                  <ul className="flex flex-wrap gap-1.5">
                    {channel.pullKeys.map((key) => (
                      <li key={key}>
                        <Badge variant="outline">{t(key)}</Badge>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="flex flex-col gap-1.5">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Upload className="size-3.5" aria-hidden />
                    {t("line.guide.push")}
                  </p>
                  <ul className="flex flex-wrap gap-1.5">
                    {channel.pushKeys.map((key) => (
                      <li key={key}>
                        <Badge variant="outline">{t(key)}</Badge>
                      </li>
                    ))}
                  </ul>
                </div>

                <p className="text-xs text-muted-foreground">
                  {t(channel.noteKey, { baseUrl: LIFF_APP_BASE_URL })}
                </p>
                <p className="flex gap-1.5 text-xs text-foreground">
                  <TriangleAlert className="size-3.5 shrink-0 translate-y-0.5 text-primary" aria-hidden />
                  {t(channel.warnKey)}
                </p>
              </li>
            ))}
          </ol>

          <p className="text-sm text-muted-foreground">{t("line.guide.entry")}</p>

          <Button asChild variant="outline" size="sm" className="self-start">
            <a href={LINE_CONSOLE_URL} target="_blank" rel="noreferrer">
              {t("line.guide.openConsole")}
              <ExternalLink />
            </a>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("line.webhookUrl")}</CardTitle>
          <CardDescription>{t("line.webhookHint")}</CardDescription>
        </CardHeader>
        <CardContent>
          <CopyableUrl value={webhookUrl} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("line.endpointUrl")}</CardTitle>
          <CardDescription>{t("line.endpointHint")}</CardDescription>
        </CardHeader>
        <CardContent>
          {endpointUrl ? (
            <CopyableUrl value={endpointUrl} />
          ) : (
            <p className="text-sm text-muted-foreground">{t("line.endpointPending")}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("line.channelCredentials")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="line_channel_id">{t("line.channelId")}</Label>
              <Input
                id="line_channel_id"
                value={form.line_channel_id}
                onChange={(e) => setForm((f) => ({ ...f, line_channel_id: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">{t("line.channelIdHint")}</p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="line_channel_secret">{t("line.channelSecret")}</Label>
              <Input
                id="line_channel_secret"
                type="password"
                value={form.line_channel_secret}
                onChange={(e) => setForm((f) => ({ ...f, line_channel_secret: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">{t("line.channelSecretHint")}</p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="line_channel_access_token">{t("line.channelAccessToken")}</Label>
              <Input
                id="line_channel_access_token"
                type="password"
                value={form.line_channel_access_token}
                onChange={(e) => setForm((f) => ({ ...f, line_channel_access_token: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">{t("line.channelAccessTokenHint")}</p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="liff_id">{t("line.liffId")}</Label>
              <Input
                id="liff_id"
                value={form.liff_id}
                onChange={(e) => setForm((f) => ({ ...f, liff_id: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">{t("line.liffIdHint")}</p>
            </div>
            <Button type="submit" disabled={save.isPending} className="self-start">
              {save.isPending ? t("common.saving") : t("common.save")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
