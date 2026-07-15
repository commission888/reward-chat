import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/auth/AuthProvider";
import { useI18n } from "@/i18n/LanguageProvider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Redemption = {
  id: string;
  reward_name: string;
  points_cost: number;
  code: string;
  status: string;
  created_at: string;
  expires_at: string;
  customers: { display_name: string | null } | null;
};

const STATUS_VARIANT: Record<string, "default" | "secondary"> = {
  completed: "default",
  cancelled: "secondary",
};

// Expiry is computed from the clock, not stored as a status: there is no job
// flipping rows, so a coupon is dead the moment its expires_at passes. The
// database enforces the same thing in complete_redemption; this only decides
// what staff see.
function isExpired(redemption: Redemption): boolean {
  return new Date(redemption.expires_at).getTime() <= Date.now();
}

export default function RedemptionsPage() {
  const { profile } = useAuth();
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const shopId = profile?.shop_id ?? null;

  const pending = useQuery({
    queryKey: ["redemptions", "pending", shopId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("redemptions")
        .select("id, reward_name, points_cost, code, status, created_at, expires_at, customers(display_name)")
        .eq("shop_id", shopId!)
        .eq("status", "pending")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as unknown as Redemption[];
    },
    enabled: Boolean(shopId),
  });

  const recent = useQuery({
    queryKey: ["redemptions", "recent", shopId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("redemptions")
        .select("id, reward_name, points_cost, code, status, created_at, expires_at, customers(display_name)")
        .eq("shop_id", shopId!)
        .neq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data as unknown as Redemption[];
    },
    enabled: Boolean(shopId),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["redemptions"] });
  };

  const approve = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("complete_redemption", { p_redemption_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("redemptions.approved"));
      invalidate();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : t("redemptions.errApprove")),
  });

  // There is no reject. Redeeming spends the points for good, so a reject would
  // either have to hand them back — which is exactly what the shop asked not to
  // happen — or take them for nothing. An unwanted coupon simply expires.
  const busy = approve.isPending;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{t("redemptions.title")}</h1>
        <p className="text-muted-foreground">{t("redemptions.subtitle")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("redemptions.pending")}</CardTitle>
          <CardDescription>{t("redemptions.pendingHint")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("redemptions.code")}</TableHead>
                <TableHead>{t("redemptions.customer")}</TableHead>
                <TableHead>{t("redemptions.reward")}</TableHead>
                <TableHead>{t("redemptions.pointsCol")}</TableHead>
                <TableHead>{t("redemptions.expires")}</TableHead>
                <TableHead className="text-right">{t("common.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pending.isLoading && (
                <TableRow>
                  <TableCell colSpan={6}>{t("common.loading")}</TableCell>
                </TableRow>
              )}
              {!pending.isLoading && (pending.data?.length ?? 0) === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    {t("redemptions.noPending")}
                  </TableCell>
                </TableRow>
              )}
              {pending.data?.map((r) => {
                const expired = isExpired(r);
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono font-medium">{r.code}</TableCell>
                    <TableCell>{r.customers?.display_name ?? "—"}</TableCell>
                    <TableCell>{r.reward_name}</TableCell>
                    <TableCell>{r.points_cost}</TableCell>
                    <TableCell className={expired ? "text-destructive" : "text-muted-foreground"}>
                      {expired
                        ? t("redemptions.expiredLabel")
                        : new Date(r.expires_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {/* Disabled rather than hidden: an expired coupon a customer
                          is standing there holding needs an explanation, not a
                          missing button. complete_redemption refuses it anyway. */}
                      <Button size="sm" onClick={() => approve.mutate(r.id)} disabled={busy || expired}>
                        {t("redemptions.approve")}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("redemptions.recent")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("redemptions.code")}</TableHead>
                <TableHead>{t("redemptions.customer")}</TableHead>
                <TableHead>{t("redemptions.reward")}</TableHead>
                <TableHead>{t("redemptions.pointsCol")}</TableHead>
                <TableHead>{t("common.status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!recent.isLoading && (recent.data?.length ?? 0) === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    {t("redemptions.nothingYet")}
                  </TableCell>
                </TableRow>
              )}
              {recent.data?.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono">{r.code}</TableCell>
                  <TableCell>{r.customers?.display_name ?? "—"}</TableCell>
                  <TableCell>{r.reward_name}</TableCell>
                  <TableCell>{r.points_cost}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[r.status] ?? "secondary"}>{t(`status.${r.status}`)}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
