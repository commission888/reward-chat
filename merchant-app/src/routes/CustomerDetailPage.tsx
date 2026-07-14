import { useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/i18n/LanguageProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function CustomerDetailPage() {
  const { customerId: customerIdParam } = useParams<{ customerId: string }>();
  const customerId = customerIdParam ?? "";
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("manual_adjustment");

  const { data: customer } = useQuery({
    queryKey: ["customer", customerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, display_name, phone, points_balance")
        .eq("id", customerId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: Boolean(customerId),
  });

  const { data: history } = useQuery({
    queryKey: ["customer", customerId, "history"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("points_transactions")
        .select("id, delta, reason, balance_after, created_at")
        .eq("customer_id", customerId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: Boolean(customerId),
  });

  const adjustPoints = useMutation({
    mutationFn: async () => {
      const parsed = Number(delta);
      if (!Number.isInteger(parsed) || parsed === 0) throw new Error(t("customerDetail.enterNonZero"));
      const { error } = await supabase.rpc("apply_points", {
        p_customer_id: customerId,
        p_delta: parsed,
        p_reason: reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("customerDetail.balanceUpdated"));
      setDelta("");
      queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
      queryClient.invalidateQueries({ queryKey: ["customer", customerId, "history"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    adjustPoints.mutate();
  }

  if (!customer) return null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{customer.display_name ?? t("customerDetail.unnamed")}</h1>
        <p className="text-muted-foreground">{customer.phone ?? t("customerDetail.noPhone")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("customerDetail.balance", { points: customer.points_balance })}</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-wrap items-end gap-3" onSubmit={handleSubmit}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="delta">{t("customerDetail.adjustment")}</Label>
              <Input
                id="delta"
                type="number"
                value={delta}
                onChange={(e) => setDelta(e.target.value)}
                className="w-40"
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="reason">{t("common.reason")}</Label>
              <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} className="w-56" />
            </div>
            <Button type="submit" disabled={adjustPoints.isPending}>
              {adjustPoints.isPending ? t("common.applying") : t("common.apply")}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("customerDetail.history")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.date")}</TableHead>
                <TableHead>{t("customerDetail.change")}</TableHead>
                <TableHead>{t("common.reason")}</TableHead>
                <TableHead className="text-right">{t("customerDetail.balanceAfter")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history?.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="text-muted-foreground">
                    {new Date(entry.created_at).toLocaleString()}
                  </TableCell>
                  <TableCell className={entry.delta >= 0 ? "text-primary" : "text-destructive"}>
                    {entry.delta >= 0 ? `+${entry.delta}` : entry.delta}
                  </TableCell>
                  <TableCell>{entry.reason}</TableCell>
                  <TableCell className="text-right">{entry.balance_after}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
