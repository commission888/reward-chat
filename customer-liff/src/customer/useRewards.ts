import { useCallback, useEffect, useState } from "react";
import { getFunctionErrorMessage } from "@rewardchat/shared";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/i18n/LanguageProvider";

export type Reward = {
  id: string;
  name: string;
  description: string | null;
  points_cost: number;
};

export type Redemption = {
  id: string;
  reward_name: string;
  points_cost: number;
  code: string;
  status: string;
  created_at: string;
  expires_at: string;
};

// Expiry is computed from the clock — no job flips these rows, so a coupon is
// simply dead once its expires_at passes. complete_redemption enforces the same
// rule server-side; this only decides what the customer is shown.
export function isExpired(redemption: Redemption): boolean {
  return new Date(redemption.expires_at).getTime() <= Date.now();
}

// Rewards catalog + the customer's own coupons, both fetched from the
// get-rewards edge function (customers have no table access; the signed loyalty
// token proves identity). `redeem` creates a pending redemption that staff
// later approve in the merchant app.
export function useRewards(qrToken: string | null) {
  const { t } = useI18n();
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [redemptions, setRedemptions] = useState<Redemption[]>([]);
  // The shop's floor on redeeming at all, separate from each reward's own cost.
  // null = the shop hasn't set one.
  const [redeemThreshold, setRedeemThreshold] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!qrToken) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke<{
        rewards: Reward[];
        redemptions: Redemption[];
        redeem_threshold: number | null;
      }>("get-rewards", { body: { qr_token: qrToken } });
      if (fnError) throw fnError;
      setRewards(data?.rewards ?? []);
      setRedemptions(data?.redemptions ?? []);
      setRedeemThreshold(data?.redeem_threshold ?? null);
    } catch (err) {
      setError(await getFunctionErrorMessage(err, t("card.loadFailed")));
    } finally {
      setLoading(false);
    }
  }, [qrToken, t]);

  useEffect(() => {
    reload();
  }, [reload]);

  const redeem = useCallback(
    async (rewardId: string) => {
      if (!qrToken) return;
      const { error: fnError } = await supabase.functions.invoke("create-redemption", {
        body: { qr_token: qrToken, reward_id: rewardId },
      });
      if (fnError) throw new Error(await getFunctionErrorMessage(fnError, t("card.redeemFailed")));
      await reload();
    },
    [qrToken, reload, t]
  );

  return { rewards, redemptions, redeemThreshold, loading, error, reload, redeem };
}
