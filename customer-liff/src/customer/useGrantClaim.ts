import { useEffect, useRef, useState } from "react";
import { getFunctionErrorMessage } from "@rewardchat/shared";
import { supabase } from "@/lib/supabaseClient";
import { clearGrantToken, takeGrantToken } from "@/lib/liffIdentity";

type ClaimResult = { points: number; balance: number };

// Claims a points QR the moment the card is ready. Automatic on purpose: the
// customer already made their choice when they pointed their camera at the code,
// so making them press another button here would be pure ceremony.
export function useGrantClaim(qrToken: string | null, onClaimed: (balance: number) => void) {
  const [result, setResult] = useState<ClaimResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Registration re-runs (StrictMode's double effect, a refresh mid-claim), and
  // firing the claim twice would race two requests for one grant. The server
  // handles that safely, but there's no reason to send the second one.
  const attempted = useRef(false);

  useEffect(() => {
    if (!qrToken || attempted.current) return;
    const grant = takeGrantToken();
    if (!grant) return;
    attempted.current = true;

    (async () => {
      try {
        const { data, error: fnError } = await supabase.functions.invoke<ClaimResult>("claim-point-grant", {
          body: { qr_token: qrToken, grant },
        });
        if (fnError) throw fnError;
        if (data) {
          setResult(data);
          onClaimed(data.balance);
        }
      } catch (err) {
        setError(await getFunctionErrorMessage(err, "Could not collect these points"));
      } finally {
        // Win or lose, this token is spent as far as this device is concerned.
        clearGrantToken();
      }
    })();
    // onClaimed is a fresh closure each render; re-running on it would defeat
    // the one-shot guard above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrToken]);

  return { result, error };
}
