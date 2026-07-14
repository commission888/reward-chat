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
  customers: { display_name: string | null } | null;
};

const STATUS_VARIANT: Record<string, "default" | "secondary"> = {
  completed: "default",
  cancelled: "secondary",
};

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
        .select("id, reward_name, points_cost, code, status, created_at, customers(display_name)")
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
        .select("id, reward_name, points_cost, code, status, created_at, customers(display_name)")
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

  const reject = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("cancel_redemption", { p_redemption_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("redemptions.rejected"));
      invalidate();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : t("redemptions.errReject")),
  });

  const busy = approve.isPending || reject.isPending;

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
                <TableHead className="text-right">{t("common.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pending.isLoading && (
                <TableRow>
                  <TableCell colSpan={5}>{t("common.loading")}</TableCell>
                </TableRow>
              )}
              {!pending.isLoading && (pending.data?.length ?? 0) === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    {t("redemptions.noPending")}
                  </TableCell>
                </TableRow>
              )}
              {pending.data?.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono font-medium">{r.code}</TableCell>
                  <TableCell>{r.customers?.display_name ?? "—"}</TableCell>
                  <TableCell>{r.reward_name}</TableCell>
                  <TableCell>{r.points_cost}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button size="sm" onClick={() => approve.mutate(r.id)} disabled={busy}>
                        {t("redemptions.approve")}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => reject.mutate(r.id)} disabled={busy}>
                        {t("redemptions.reject")}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
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
