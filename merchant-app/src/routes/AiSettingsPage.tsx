import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getFunctionErrorMessage } from "@rewardchat/shared";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/auth/AuthProvider";
import { useI18n } from "@/i18n/LanguageProvider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const OPENAI_KEYS_URL = "https://platform.openai.com/api-keys";

export default function AiSettingsPage() {
  const { profile } = useAuth();
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const shopId = profile?.shop_id ?? null;
  const [key, setKey] = useState("");

  const { data: shop, isLoading } = useQuery({
    queryKey: ["shop-ai", shopId],
    queryFn: async () => {
      const { data, error } = await supabase.from("shops").select("openai_api_key").eq("id", shopId!).single();
      if (error) throw error;
      return data;
    },
    enabled: Boolean(shopId),
  });

  const configured = Boolean(shop?.openai_api_key);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.functions.invoke("update-shop-ai-settings", {
        body: { openai_api_key: key.trim() === "" ? null : key.trim() },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(key.trim() === "" ? t("ai.cleared") : t("ai.saved"));
      setKey("");
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
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{t("ai.title")}</h1>
        <p className="text-muted-foreground">{t("ai.subtitle")}</p>
      </div>

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
              <Label htmlFor="openai_api_key">{t("ai.keyLabel")}</Label>
              <Input
                id="openai_api_key"
                type="password"
                autoComplete="off"
                // The saved key is never echoed back into this field — it stays
                // write-only from the UI's side, and the badge above is how you
                // tell whether one is stored.
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
                <a href={OPENAI_KEYS_URL} target="_blank" rel="noreferrer">
                  {t("ai.openDashboard")}
                </a>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

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
