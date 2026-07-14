import { useEffect, useRef, useState, type FormEvent } from "react";
import { BrowserQRCodeReader, type IScannerControls } from "@zxing/browser";
import { toast } from "sonner";
import { getFunctionErrorMessage } from "@rewardchat/shared";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/i18n/LanguageProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function ScanPage() {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const [qrToken, setQrToken] = useState("");
  const [delta, setDelta] = useState("10");
  const [reason, setReason] = useState("purchase");
  const [scanning, setScanning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState<{ balance: number } | null>(null);

  useEffect(() => {
    return () => {
      controlsRef.current?.stop();
    };
  }, []);

  async function startScanning() {
    if (!videoRef.current) return;
    setScanning(true);
    try {
      const reader = new BrowserQRCodeReader();
      const controls = await reader.decodeFromVideoDevice(undefined, videoRef.current, (result) => {
        if (result) {
          setQrToken(result.getText());
          controlsRef.current?.stop();
          setScanning(false);
        }
      });
      controlsRef.current = controls;
    } catch (error) {
      setScanning(false);
      toast.error(error instanceof Error ? error.message : t("scan.cameraError"));
    }
  }

  function stopScanning() {
    controlsRef.current?.stop();
    setScanning(false);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const parsedDelta = Number(delta);
    if (!qrToken.trim()) {
      toast.error(t("scan.scanFirst"));
      return;
    }
    if (!Number.isInteger(parsedDelta) || parsedDelta === 0) {
      toast.error(t("scan.enterNonZero"));
      return;
    }
    setSubmitting(true);
    setLastResult(null);
    const { data, error } = await supabase.functions.invoke<{ balance: number }>("apply-points", {
      body: { qr_token: qrToken.trim(), delta: parsedDelta, reason },
    });
    setSubmitting(false);
    if (error) {
      toast.error(await getFunctionErrorMessage(error));
      return;
    }
    setLastResult(data ?? null);
    toast.success(t("scan.newBalance", { points: data?.balance ?? 0 }));
    setQrToken("");
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{t("scan.title")}</h1>
        <p className="text-muted-foreground">{t("scan.subtitle")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("scan.camera")}</CardTitle>
          <CardDescription>{t("scan.cameraHint")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <video ref={videoRef} className="w-full max-w-sm rounded-md bg-muted" muted />
          <div className="flex gap-2">
            {!scanning ? (
              <Button type="button" onClick={startScanning}>
                {t("scan.startCamera")}
              </Button>
            ) : (
              <Button type="button" variant="outline" onClick={stopScanning}>
                {t("scan.stopCamera")}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("scan.applyPoints")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="qr-token">{t("scan.cardToken")}</Label>
              <Input
                id="qr-token"
                placeholder={t("scan.cardTokenPlaceholder")}
                value={qrToken}
                onChange={(e) => setQrToken(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="delta">{t("scan.pointsLabel")}</Label>
                <Input
                  id="delta"
                  type="number"
                  className="w-40"
                  value={delta}
                  onChange={(e) => setDelta(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="reason">{t("common.reason")}</Label>
                <Input id="reason" className="w-56" value={reason} onChange={(e) => setReason(e.target.value)} />
              </div>
            </div>
            <Button type="submit" disabled={submitting}>
              {submitting ? t("common.applying") : t("common.apply")}
            </Button>
            {lastResult && (
              <p className="text-sm text-muted-foreground">{t("scan.newBalance", { points: lastResult.balance })}</p>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
