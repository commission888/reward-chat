import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useCustomer } from "@/customer/CustomerProvider";
import { useRewards } from "@/customer/useRewards";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

export default function CardPage() {
  const { customer, qrToken, shop, loading, error, refresh } = useCustomer();
  const rewardsState = useRewards(qrToken);
  const [redeemingId, setRedeemingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6">
        <Skeleton className="h-40 w-72 rounded-xl" />
        <p className="text-sm text-muted-foreground">Joining {shop?.name ?? "the"} loyalty program...</p>
      </div>
    );
  }

  if (error || !customer || !qrToken) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center">
        <p className="text-sm text-destructive">{error ?? "Something went wrong."}</p>
        <Button onClick={() => refresh()}>Try again</Button>
      </div>
    );
  }

  const initials = (customer.display_name ?? "?").slice(0, 1).toUpperCase();
  const pendingCoupons = rewardsState.redemptions.filter((r) => r.status === "pending");
  const pastCoupons = rewardsState.redemptions.filter((r) => r.status !== "pending");

  async function handleRedeem(rewardId: string) {
    setActionError(null);
    setRedeemingId(rewardId);
    try {
      await rewardsState.redeem(rewardId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not redeem");
    } finally {
      setRedeemingId(null);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-sm flex-col gap-6 bg-background p-5">
      <div className="text-center">
        <p className="text-sm font-medium text-muted-foreground">{shop?.name ?? "Loyalty Card"}</p>
      </div>

      {/* Member + points + loyalty QR */}
      <Card>
        <CardHeader className="flex flex-row items-center gap-3">
          <Avatar>
            <AvatarImage src={customer.picture_url ?? undefined} alt={customer.display_name ?? "Customer"} />
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <p className="font-medium text-foreground">{customer.display_name ?? "Member"}</p>
            <p className="text-sm text-muted-foreground">
              <span className="text-lg font-semibold text-primary">{customer.points_balance}</span> points
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              refresh();
              rewardsState.reload();
            }}
          >
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-3 pb-6">
          <div className="rounded-xl border border-border bg-card p-4">
            <QRCodeSVG value={qrToken} size={176} fgColor="#0F172A" bgColor="#FFFFFF" />
          </div>
          <p className="text-center text-xs text-muted-foreground">
            Show this code to staff to earn points.
          </p>
        </CardContent>
      </Card>

      {/* Pending coupons */}
      {pendingCoupons.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-foreground">Your coupons</h2>
          {pendingCoupons.map((c) => (
            <Card key={c.id} className="border-primary/40 bg-primary/5">
              <CardContent className="flex flex-col items-center gap-2 py-5">
                <p className="text-sm font-medium text-foreground">{c.reward_name}</p>
                <p className="font-mono text-2xl font-bold tracking-widest text-primary">{c.code}</p>
                <p className="text-center text-xs text-muted-foreground">
                  Show this code to staff. Waiting for staff to approve ({c.points_cost} points).
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Rewards catalog */}
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-foreground">Rewards</h2>
        {actionError && <p className="text-sm text-destructive">{actionError}</p>}
        {rewardsState.loading && <Skeleton className="h-20 w-full rounded-xl" />}
        {!rewardsState.loading && rewardsState.rewards.length === 0 && (
          <p className="text-sm text-muted-foreground">No rewards available yet.</p>
        )}
        {rewardsState.rewards.map((reward) => {
          const affordable = customer.points_balance >= reward.points_cost;
          return (
            <Card key={reward.id}>
              <CardContent className="flex items-center justify-between gap-3 py-4">
                <div className="flex-1">
                  <p className="font-medium text-foreground">{reward.name}</p>
                  {reward.description && (
                    <p className="text-sm text-muted-foreground">{reward.description}</p>
                  )}
                  <p className="mt-1 text-sm font-medium text-primary">{reward.points_cost} points</p>
                </div>
                <Button
                  size="sm"
                  disabled={!affordable || redeemingId !== null}
                  onClick={() => handleRedeem(reward.id)}
                >
                  {redeemingId === reward.id ? "..." : affordable ? "Redeem" : "Not enough"}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Coupon history */}
      {pastCoupons.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-foreground">History</h2>
          {pastCoupons.map((c) => (
            <div key={c.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
              <span className="text-foreground">{c.reward_name}</span>
              <span className={c.status === "completed" ? "text-muted-foreground" : "text-destructive"}>
                {c.status === "completed" ? "Redeemed" : "Rejected"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
