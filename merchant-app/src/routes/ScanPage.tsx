import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { getFunctionErrorMessage } from "@rewardchat/shared";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/i18n/LanguageProvider";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const POINT_CHOICES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

type Grant = { points: number; expires_at: string; url: string };

function secondsLeft(expiresAt: string): number {
  return Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
}

export default function ScanPage() {
  const { t } = useI18n();
  const [points, setPoints] = useState("1");
  const [creating, setCreating] = useState(false);
  const [grant, setGrant] = useState<Grant | null>(null);
  const [remaining, setRemaining] = useState(0);

  // A live countdown matters here: the QR silently stops working at expiry, and
  // staff need to know that before a customer walks off with a dead code.
  useEffect(() => {
    if (!grant) return;
    setRemaining(secondsLeft(grant.expires_at));
    const id = setInterval(() => setRemaining(secondsLeft(grant.expires_at)), 1000);
    return () => clearInterval(id);
  }, [grant]);

  async function createGrant() {
    setCreating(true);
    const { data, error } = await supabase.functions.invoke<{ grant: Grant }>("create-point-grant", {
      body: { points: Number(points) },
    });
    setCreating(false);
    if (error) {
      toast.error(await getFunctionErrorMessage(error, t("scan.createFailed")));
      return;
    }
    setGrant(data?.grant ?? null);
  }

  const expired = grant !== null && remaining === 0;
  const countdown = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("scan.title")} subtitle={t("scan.subtitle")} />

      <Card>
        <CardHeader>
          <CardTitle>{t("scan.create")}</CardTitle>
          <CardDescription>{t("scan.singleUse")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="points">{t("scan.pointsLabel")}</Label>
            <Select value={points} onValueChange={setPoints}>
              <SelectTrigger id="points" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {POINT_CHOICES.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {t("scan.pointsUnit", { points: n })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="button" onClick={createGrant} disabled={creating}>
            {creating ? t("scan.creating") : grant ? t("scan.newCode") : t("scan.create")}
          </Button>
        </CardContent>
      </Card>

      {grant && (
        <Card>
          <CardHeader>
            <CardTitle>{t("scan.qrTitle")}</CardTitle>
            <CardDescription>{t("scan.qrHint")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-3">
            {expired ? (
              <p className="py-10 text-center text-destructive">{t("scan.expired")}</p>
            ) : (
              <>
                <div className="rounded-2xl border border-border bg-white p-4">
                  <QRCodeSVG value={grant.url} size={240} fgColor="#0F172A" bgColor="#FFFFFF" />
                </div>
                <p className="text-lg font-semibold text-foreground">
                  {t("scan.worth", { points: grant.points })}
                </p>
                <p className="text-sm text-muted-foreground">{t("scan.expiresIn", { time: countdown })}</p>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
