import { useEffect, useRef, useState } from "react";
import { BrowserQRCodeReader, type IScannerControls } from "@zxing/browser";
import { useI18n } from "@/i18n/LanguageProvider";
import { Button } from "@/components/ui/button";

type Props = {
  // Called once per scan with the decoded QR text. The parent decides what it
  // means (here: a redemption id it hands to complete_redemption).
  onDecode: (text: string) => void;
  disabled?: boolean;
};

// A live camera QR reader. Passing `undefined` as the device id lets zxing pick
// the environment-facing (rear) camera, which is what a phone at the counter
// wants. The camera only runs while `active` — it is released on stop, on a
// successful scan, and on unmount, so navigating away never leaves it on.
export function QrScanner({ onDecode, disabled }: Props) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // Latest onDecode without restarting the camera every parent render.
  const onDecodeRef = useRef(onDecode);
  onDecodeRef.current = onDecode;
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    // Captured now so the cleanup below releases the same element's stream even
    // if the ref is later repointed.
    const video = videoRef.current;
    const reader = new BrowserQRCodeReader();
    let controls: IScannerControls | null = null;
    let cancelled = false;
    // Continuous decode fires many times a second — this makes one scan mean one
    // call, and stops the camera before the parent's mutation runs.
    let handled = false;
    setError(null);

    reader
      .decodeFromVideoDevice(undefined, video ?? undefined, (result) => {
        if (handled || !result) return;
        handled = true;
        controls?.stop();
        setActive(false);
        onDecodeRef.current(result.getText());
      })
      .then((c) => {
        controls = c;
        // The effect can be torn down before decodeFromVideoDevice resolves;
        // stop the stream it just opened rather than leaking it.
        if (cancelled) c.stop();
      })
      .catch(() => {
        if (cancelled) return;
        setError(t("redemptions.cameraError"));
        setActive(false);
      });

    return () => {
      cancelled = true;
      controls?.stop();
      // Belt and suspenders: release any stream still attached to the element.
      const stream = video?.srcObject as MediaStream | null;
      stream?.getTracks().forEach((track) => track.stop());
    };
    // onDecode is read through a ref; t only feeds the error string.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return (
    <div className="flex flex-col items-center gap-3">
      {active ? (
        <>
          <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-black">
            <video ref={videoRef} className="aspect-square w-full object-cover" muted playsInline />
          </div>
          <p className="text-sm text-muted-foreground">{t("redemptions.scanAlign")}</p>
          <Button variant="outline" onClick={() => setActive(false)}>
            {t("redemptions.scanStop")}
          </Button>
        </>
      ) : (
        <Button onClick={() => setActive(true)} disabled={disabled}>
          {t("redemptions.scan")}
        </Button>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
