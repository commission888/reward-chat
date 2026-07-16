import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/auth/AuthProvider";
import { useI18n } from "@/i18n/LanguageProvider";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function DashboardPage() {
  const { profile } = useAuth();
  const { t } = useI18n();

  const { data: customerCount } = useQuery({
    queryKey: ["dashboard", "customer-count", profile?.shop_id],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("customers")
        .select("*", { count: "exact", head: true });
      if (error) throw error;
      return count ?? 0;
    },
    enabled: Boolean(profile?.shop_id),
  });

  const { data: pointsIssued } = useQuery({
    queryKey: ["dashboard", "points-issued", profile?.shop_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("points_transactions")
        .select("delta")
        .gt("delta", 0);
      if (error) throw error;
      return (data ?? []).reduce((sum, row) => sum + row.delta, 0);
    },
    enabled: Boolean(profile?.shop_id),
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("dashboard.title")} subtitle={t("dashboard.subtitle")} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardDescription>{t("dashboard.totalCustomers")}</CardDescription>
            <CardTitle className="text-3xl">{customerCount ?? "—"}</CardTitle>
          </CardHeader>
          <CardContent />
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>{t("dashboard.pointsIssued")}</CardDescription>
            <CardTitle className="text-3xl">{pointsIssued ?? "—"}</CardTitle>
          </CardHeader>
          <CardContent />
        </Card>
      </div>
    </div>
  );
}
