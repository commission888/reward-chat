import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getFunctionErrorMessage } from "@rewardchat/shared";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { THAI_BANKS } from "@/lib/thaiBanks";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  credited: "default",
  rejected: "secondary",
  duplicate: "secondary",
  error: "destructive",
};

export default function PaymentSettingsPage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    slip2go_api_secret: "",
    slip_receiver_account_type: "",
    slip_receiver_account_name_th: "",
    slip_receiver_account_name_en: "",
    slip_receiver_account_number: "",
  });

  // Seed the form from the server exactly once so a background refetch (e.g. React
  // Query's refetch-on-window-focus) can't clobber unsaved edits.
  const seeded = useRef(false);

  const { data: shop } = useQuery({
    queryKey: ["shop-payment-settings", profile?.shop_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shops")
        .select(
          "slip2go_api_secret, slip_receiver_account_type, slip_receiver_account_name_th, slip_receiver_account_name_en, slip_receiver_account_number"
        )
        .eq("id", profile!.shop_id!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: Boolean(profile?.shop_id),
  });

  useEffect(() => {
    if (shop && !seeded.current) {
      seeded.current = true;
      setForm({
        slip2go_api_secret: shop.slip2go_api_secret ?? "",
        slip_receiver_account_type: shop.slip_receiver_account_type ?? "",
        slip_receiver_account_name_th: shop.slip_receiver_account_name_th ?? "",
        slip_receiver_account_name_en: shop.slip_receiver_account_name_en ?? "",
        slip_receiver_account_number: shop.slip_receiver_account_number ?? "",
      });
    }
  }, [shop]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.functions.invoke("update-shop-payment-settings", { body: form });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Payment settings saved");
      queryClient.invalidateQueries({ queryKey: ["shop-payment-settings", profile?.shop_id] });
    },
    onError: (error) => {
      void getFunctionErrorMessage(error).then((message) => toast.error(message));
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  const { data: verifications, isLoading: verificationsLoading } = useQuery({
    queryKey: ["slip-verifications"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("slip_verifications")
        .select("id, amount, sender_name, bank_name, status, points_awarded, created_at")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Payment settings</h1>
        <p className="text-muted-foreground">
          When configured, customers who send a payment slip photo directly in your LINE chat get it verified and
          points credited automatically.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Slip2Go</CardTitle>
          <CardDescription>
            Get your API secret from your{" "}
            <a
              href="https://slip2go.com"
              target="_blank"
              rel="noreferrer"
              className="text-primary underline"
            >
              Slip2Go
            </a>{" "}
            account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="slip2go_api_secret">Slip2Go API secret</Label>
              <Input
                id="slip2go_api_secret"
                type="password"
                value={form.slip2go_api_secret}
                onChange={(e) => setForm((f) => ({ ...f, slip2go_api_secret: e.target.value }))}
              />
            </div>

            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              Fill in your receiving bank account below. If left blank, <strong>any</strong> genuine bank slip —
              even one paid to someone else entirely — will be accepted and credited with points.
            </div>

            <div className="flex flex-wrap gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="slip_receiver_account_type">Bank</Label>
                <Select
                  value={form.slip_receiver_account_type}
                  onValueChange={(value) =>
                    setForm((f) => ({ ...f, slip_receiver_account_type: value }))
                  }
                >
                  <SelectTrigger id="slip_receiver_account_type" className="w-72">
                    <SelectValue placeholder="Select bank" />
                  </SelectTrigger>
                  <SelectContent>
                    {THAI_BANKS.map((bank) => (
                      <SelectItem key={bank.code} value={bank.code}>
                        {bank.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="slip_receiver_account_number">Account number</Label>
                <Input
                  id="slip_receiver_account_number"
                  className="w-56"
                  value={form.slip_receiver_account_number}
                  onChange={(e) => setForm((f) => ({ ...f, slip_receiver_account_number: e.target.value }))}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="slip_receiver_account_name_th">Account name (Thai)</Label>
                <Input
                  id="slip_receiver_account_name_th"
                  className="w-64"
                  value={form.slip_receiver_account_name_th}
                  onChange={(e) => setForm((f) => ({ ...f, slip_receiver_account_name_th: e.target.value }))}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="slip_receiver_account_name_en">Account name (English)</Label>
                <Input
                  id="slip_receiver_account_name_en"
                  className="w-64"
                  value={form.slip_receiver_account_name_en}
                  onChange={(e) => setForm((f) => ({ ...f, slip_receiver_account_name_en: e.target.value }))}
                />
              </div>
            </div>

            <Button type="submit" disabled={save.isPending} className="self-start">
              {save.isPending ? "Saving..." : "Save"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent slip verifications</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Sender</TableHead>
                <TableHead>Bank</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Points</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {verificationsLoading && (
                <TableRow>
                  <TableCell colSpan={6}>Loading...</TableCell>
                </TableRow>
              )}
              {verifications?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    No slips verified yet.
                  </TableCell>
                </TableRow>
              )}
              {verifications?.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="text-muted-foreground">{new Date(v.created_at).toLocaleString()}</TableCell>
                  <TableCell>{v.sender_name ?? "—"}</TableCell>
                  <TableCell>{v.bank_name ?? "—"}</TableCell>
                  <TableCell>{v.amount != null ? `฿${v.amount}` : "—"}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[v.status] ?? "secondary"}>{v.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right">{v.points_awarded ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
