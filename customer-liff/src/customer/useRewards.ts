import { useCallback, useEffect, useState } from "react";
import { getFunctionErrorMessage } from "@rewardchat/shared";
import { supabase } from "@/lib/supabaseClient";

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
};

// Rewards catalog + the customer's own coupons, both fetched from the
// get-rewards edge function (customers have no table access; the signed loyalty
// token proves identity). `redeem` creates a pending redemption that staff
// later approve in the merchant app.
export function useRewards(qrToken: string | null) {
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [redemptions, setRedemptions] = useState<Redemption[]>([]);
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
      }>("get-rewards", { body: { qr_token: qrToken } });
      if (fnError) throw fnError;
      setRewards(data?.rewards ?? []);
      setRedemptions(data?.redemptions ?? []);
    } catch (err) {
      setError(await getFunctionErrorMessage(err, "Could not load rewards"));
    } finally {
      setLoading(false);
    }
  }, [qrToken]);

  useEffect(() => {
    reload();
  }, [reload]);

  const redeem = useCallback(
    async (rewardId: string) => {
      if (!qrToken) return;
      const { error: fnError } = await supabase.functions.invoke("create-redemption", {
        body: { qr_token: qrToken, reward_id: rewardId },
      });
      if (fnError) throw new Error(await getFunctionErrorMessage(fnError, "Could not redeem"));
      await reload();
    },
    [qrToken, reload]
  );

  return { rewards, redemptions, loading, error, reload, redeem };
}
