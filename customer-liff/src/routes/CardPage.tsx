import { useEffect, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useCustomer } from "@/customer/CustomerProvider";
import { useRewards, isExpired } from "@/customer/useRewards";
import { usePhone } from "@/customer/usePhone";
import { useGrantClaim } from "@/customer/useGrantClaim";
import { useI18n } from "@/i18n/LanguageProvider";
import { LanguageToggle } from "@/components/LanguageToggle";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function CardPage() {
  const { customer, qrToken, shop, loading, error, refresh, applyCustomer } = useCustomer();
  const rewardsState = useRewards(qrToken);
  const { savePhone, saving: savingPhone } = usePhone(qrToken);
  const grantClaim = useGrantClaim(qrToken, (balance) =>
    applyCustomer((c) => (c ? { ...c, points_balance: balance } : c)),
  );
  const { t } = useI18n();
  const [redeemingId, setRedeemingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  // null means "untouched" — the field then mirrors whatever the server has, so
  // no effect is needed to seed it once the customer loads.
  const [phoneDraft, setPhoneDraft] = useState<string | null>(null);
  const [phoneMessage, setPhoneMessage] = useState<string | null>(null);
  const phoneValue = phoneDraft ?? customer?.phone ?? "";

  // The customer opened their own shop's loyalty card — "RewardChat" (index.html's
  // fallback) means nothing to them. The shop name is DB data, so it's shown as-is
  // rather than translated, same rule as everywhere else it appears.
  useEffect(() => {
    if (shop?.name) document.title = shop.name;
  }, [shop?.name]);

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="text-base text-muted-foreground">{t("card.joining", { shop: shop?.name ?? "" })}</p>
      </div>
    );
  }

  if (error || !customer || !qrToken) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center">
        <p className="text-base text-destructive">{error ?? t("card.error")}</p>
        <Button size="lg" onClick={() => refresh()}>
          {t("card.tryAgain")}
        </Button>
      </div>
    );
  }

  const initials = (customer.display_name ?? "?").slice(0, 1).toUpperCase();
  const belowThreshold =
    rewardsState.redeemThreshold !== null && customer.points_balance < rewardsState.redeemThreshold;
  // An expired coupon is still "pending" in the database — nothing sweeps them —
  // so it's filtered out of the usable list here and shown in history instead.
  // Presenting a dead coupon as collectable would send someone to the counter
  // for a reward staff can't honour.
  const pendingCoupons = rewardsState.redemptions.filter((r) => r.status === "pending" && !isExpired(r));
  const pastCoupons = rewardsState.redemptions.filter((r) => r.status !== "pending" || isExpired(r));

  async function handleRedeem(rewardId: string) {
    setActionError(null);
    setRedeemingId(rewardId);
    try {
      await rewardsState.redeem(rewardId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t("card.redeemFailed"));
    } finally {
      setRedeemingId(null);
    }
  }

  function handleRefresh() {
    refresh();
    rewardsState.reload();
  }

  async function handleSavePhone(event: FormEvent) {
    event.preventDefault();
    setPhoneMessage(null);
    try {
      await savePhone(phoneValue);
      setPhoneDraft(null); // fall back to the server's normalized value
      setPhoneMessage(t("card.phoneSaved"));
    } catch (err) {
      setPhoneMessage(err instanceof Error ? err.message : t("card.phoneFailed"));
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-md flex-col gap-8 px-5 py-8 sm:py-10">
        {/* Points hero */}
        <header className="flex flex-col gap-5">
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {shop?.name ?? t("card.title")}
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <LanguageToggle />
              <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={handleRefresh}>
                {t("card.refresh")}
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <Avatar className="size-14">
              <AvatarImage src={customer.picture_url ?? undefined} alt={customer.display_name ?? "Customer"} />
              <AvatarFallback className="text-lg">{initials}</AvatarFallback>
            </Avatar>
            <p className="text-xl font-semibold text-foreground">{customer.display_name ?? t("card.member")}</p>
          </div>

          {/* Scanning a points QR lands here — say so before anything else. */}
          {grantClaim.result && (
            <div className="rounded-2xl border-2 border-primary bg-primary/5 px-5 py-4 text-center">
              <p className="text-lg font-semibold text-primary">
                {t("card.grantCollected", { points: grantClaim.result.points })}
              </p>
            </div>
          )}
          {grantClaim.error && (
            <div className="rounded-2xl border border-destructive/50 bg-destructive/5 px-5 py-4 text-center">
              <p className="text-sm text-destructive">{grantClaim.error}</p>
            </div>
          )}

          <div className="rounded-3xl bg-primary px-6 py-7 text-primary-foreground shadow-sm">
            <p className="text-sm font-medium text-primary-foreground/80">{t("card.pointsLabel")}</p>
            <p className="mt-1 flex items-baseline gap-2">
              <span className="text-6xl font-bold leading-none tracking-tight">{customer.points_balance}</span>
              <span className="text-xl font-medium text-primary-foreground/80">{t("card.pointsUnit")}</span>
            </p>
          </div>
        </header>

        {/* Pending coupons */}
        {pendingCoupons.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold text-foreground">{t("card.myCoupons")}</h2>
            {pendingCoupons.map((c) => (
              <div
                key={c.id}
                className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-primary/50 bg-primary/5 px-5 py-6 text-center"
              >
                <p className="text-base font-medium text-foreground">{c.reward_name}</p>
                <p className="font-mono text-4xl font-bold tracking-[0.2em] text-primary">{c.code}</p>
                <p className="text-sm text-muted-foreground">
                  {t("card.couponHint", { points: c.points_cost })}
                </p>
                {/* The points are already spent and never come back, so the
                    deadline is the one thing that still matters here. */}
                <p className="text-sm font-medium text-destructive">
                  {t("card.couponExpires", { date: new Date(c.expires_at).toLocaleDateString() })}
                </p>
              </div>
            ))}
          </section>
        )}

        {/* Rewards catalog */}
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-foreground">{t("card.rewards")}</h2>
          {/* Progress toward the shop's minimum — deliberately not phrased as
              "you can redeem X", since each reward has its own cost on top. */}
          {belowThreshold && (
            <p className="rounded-2xl bg-secondary px-5 py-3 text-center text-sm text-muted-foreground">
              {t("card.thresholdShort", { points: rewardsState.redeemThreshold! - customer.points_balance })}
            </p>
          )}
          {actionError && <p className="text-sm text-destructive">{actionError}</p>}
          {rewardsState.loading && <Skeleton className="h-24 w-full rounded-2xl" />}
          {!rewardsState.loading && rewardsState.rewards.length === 0 && (
            <p className="rounded-2xl border border-border bg-card px-5 py-6 text-center text-base text-muted-foreground">
              {t("card.noRewards")}
            </p>
          )}
          {rewardsState.rewards.map((reward) => {
            const affordable = customer.points_balance >= reward.points_cost && !belowThreshold;
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
                  <p className="mt-1 text-base font-semibold text-primary">
                    {reward.points_cost} {t("card.pointsUnit")}
                  </p>
                </div>
                <Button
                  size="lg"
                  className="shrink-0"
                  disabled={!affordable || redeemingId !== null}
                  onClick={() => handleRedeem(reward.id)}
                >
                  {redeemingId === reward.id ? "..." : affordable ? t("card.redeem") : t("card.notEnough")}
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
              <span className="text-base font-semibold text-foreground">{t("card.earnTitle")}</span>
              <span className="text-sm text-muted-foreground">{t("card.earnHint")}</span>
            </span>
            <span className="text-sm font-medium text-primary">{showQr ? t("card.hide") : t("card.showQr")}</span>
          </button>
          {showQr && (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card px-5 py-6">
              <div className="rounded-2xl border border-border bg-white p-4">
                <QRCodeSVG value={qrToken} size={200} fgColor="#0F172A" bgColor="#FFFFFF" />
              </div>
              <p className="text-center text-sm text-muted-foreground">{t("card.qrHint")}</p>
            </div>
          )}
        </section>

        {/* Phone — LINE never gives us one, so this is the only way it gets filled */}
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-foreground">{t("card.phoneTitle")}</h2>
          <form
            className="flex flex-col gap-3 rounded-2xl border border-border bg-card px-5 py-4"
            onSubmit={handleSavePhone}
          >
            <p className="text-sm text-muted-foreground">{t("card.phoneHint")}</p>
            <div className="flex gap-2">
              <Input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                aria-label={t("card.phoneTitle")}
                placeholder={t("card.phonePlaceholder")}
                value={phoneValue}
                onChange={(e) => setPhoneDraft(e.target.value)}
              />
              <Button type="submit" size="lg" className="shrink-0" disabled={savingPhone}>
                {savingPhone ? t("card.phoneSaving") : t("card.phoneSave")}
              </Button>
            </div>
            {phoneMessage && <p className="text-sm text-muted-foreground">{phoneMessage}</p>}
          </form>
        </section>

        {/* History */}
        {pastCoupons.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-foreground">{t("card.history")}</h2>
            {pastCoupons.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3 text-base"
              >
                <span className="text-foreground">{c.reward_name}</span>
                <span className={c.status === "completed" ? "text-muted-foreground" : "text-destructive"}>
                  {c.status === "completed"
                    ? t("card.used")
                    : c.status === "pending"
                      ? t("card.expired")
                      : t("card.rejected")}
                </span>
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
