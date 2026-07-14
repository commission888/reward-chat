import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useCustomer } from "@/customer/CustomerProvider";
import { useRewards } from "@/customer/useRewards";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

export default function CardPage() {
  const { customer, qrToken, shop, loading, error, refresh } = useCustomer();
  const rewardsState = useRewards(qrToken);
  const [redeemingId, setRedeemingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6">
        <Skeleton className="h-44 w-full max-w-md rounded-3xl" />
        <p className="text-base text-muted-foreground">กำลังเข้าสู่ระบบสะสมแต้ม {shop?.name ?? ""}...</p>
      </div>
    );
  }

  if (error || !customer || !qrToken) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center">
        <p className="text-base text-destructive">{error ?? "เกิดข้อผิดพลาด"}</p>
        <Button size="lg" onClick={() => refresh()}>
          ลองใหม่
        </Button>
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
      setActionError(err instanceof Error ? err.message : "แลกไม่สำเร็จ");
    } finally {
      setRedeemingId(null);
    }
  }

  function handleRefresh() {
    refresh();
    rewardsState.reload();
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-md flex-col gap-8 px-5 py-8 sm:py-10">
        {/* Points hero */}
        <header className="flex flex-col gap-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {shop?.name ?? "บัตรสะสมแต้ม"}
            </p>
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={handleRefresh}>
              รีเฟรช
            </Button>
          </div>

          <div className="flex items-center gap-4">
            <Avatar className="size-14">
              <AvatarImage src={customer.picture_url ?? undefined} alt={customer.display_name ?? "Customer"} />
              <AvatarFallback className="text-lg">{initials}</AvatarFallback>
            </Avatar>
            <p className="text-xl font-semibold text-foreground">{customer.display_name ?? "สมาชิก"}</p>
          </div>

          <div className="rounded-3xl bg-primary px-6 py-7 text-primary-foreground shadow-sm">
            <p className="text-sm font-medium text-primary-foreground/80">แต้มสะสม</p>
            <p className="mt-1 flex items-baseline gap-2">
              <span className="text-6xl font-bold leading-none tracking-tight">{customer.points_balance}</span>
              <span className="text-xl font-medium text-primary-foreground/80">แต้ม</span>
            </p>
          </div>
        </header>

        {/* Pending coupons */}
        {pendingCoupons.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold text-foreground">คูปองของฉัน</h2>
            {pendingCoupons.map((c) => (
              <div
                key={c.id}
                className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-primary/50 bg-primary/5 px-5 py-6 text-center"
              >
                <p className="text-base font-medium text-foreground">{c.reward_name}</p>
                <p className="font-mono text-4xl font-bold tracking-[0.2em] text-primary">{c.code}</p>
                <p className="text-sm text-muted-foreground">
                  แสดงรหัสนี้ให้พนักงาน • รออนุมัติ ({c.points_cost} แต้ม)
                </p>
              </div>
            ))}
          </section>
        )}

        {/* Rewards catalog */}
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-foreground">แลกของรางวัล</h2>
          {actionError && <p className="text-sm text-destructive">{actionError}</p>}
          {rewardsState.loading && <Skeleton className="h-24 w-full rounded-2xl" />}
          {!rewardsState.loading && rewardsState.rewards.length === 0 && (
            <p className="rounded-2xl border border-border bg-card px-5 py-6 text-center text-base text-muted-foreground">
              ยังไม่มีของรางวัลในตอนนี้
            </p>
          )}
          {rewardsState.rewards.map((reward) => {
            const affordable = customer.points_balance >= reward.points_cost;
            return (
              <div
                key={reward.id}
                className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-card px-5 py-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-lg font-semibold text-foreground">{reward.name}</p>
                  {reward.description && (
                    <p className="text-sm text-muted-foreground">{reward.description}</p>
                  )}
                  <p className="mt-1 text-base font-semibold text-primary">{reward.points_cost} แต้ม</p>
                </div>
                <Button
                  size="lg"
                  className="shrink-0"
                  disabled={!affordable || redeemingId !== null}
                  onClick={() => handleRedeem(reward.id)}
                >
                  {redeemingId === reward.id ? "..." : affordable ? "แลก" : "แต้มไม่พอ"}
                </Button>
              </div>
            );
          })}
        </section>

        {/* Earn points QR — secondary, collapsible */}
        <section className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => setShowQr((v) => !v)}
            className="flex items-center justify-between rounded-2xl border border-border bg-card px-5 py-4 text-left"
          >
            <span className="flex flex-col">
              <span className="text-base font-semibold text-foreground">รับแต้ม</span>
              <span className="text-sm text-muted-foreground">ให้พนักงานสแกนเพื่อสะสมแต้ม</span>
            </span>
            <span className="text-sm font-medium text-primary">{showQr ? "ซ่อน" : "แสดง QR"}</span>
          </button>
          {showQr && (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card px-5 py-6">
              <div className="rounded-2xl border border-border bg-white p-4">
                <QRCodeSVG value={qrToken} size={200} fgColor="#0F172A" bgColor="#FFFFFF" />
              </div>
              <p className="text-center text-sm text-muted-foreground">แสดงโค้ดนี้ให้พนักงานเพื่อรับแต้ม</p>
            </div>
          )}
        </section>

        {/* History */}
        {pastCoupons.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-foreground">ประวัติ</h2>
            {pastCoupons.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3 text-base"
              >
                <span className="text-foreground">{c.reward_name}</span>
                <span className={c.status === "completed" ? "text-muted-foreground" : "text-destructive"}>
                  {c.status === "completed" ? "ใช้แล้ว" : "ปฏิเสธแล้ว"}
                </span>
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
