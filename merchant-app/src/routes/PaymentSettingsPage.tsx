import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, QrCode, Trash2 } from "lucide-react";
import { getFunctionErrorMessage } from "@rewardchat/shared";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/auth/AuthProvider";
import { useI18n } from "@/i18n/LanguageProvider";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { THAI_BANKS, MERCHANT_ACCOUNT_TYPES } from "@/lib/thaiBanks";
import { decodeQrFromFile, extractKShopReceiver } from "@/lib/thaiQr";

// Merchant/e-wallet types identify the receiver by a Merchant ID (KShop) or
// wallet number, not a bank account number — so the number field relabels itself
// to match, since "account number" reads as wrong for a KShop QR.
const MERCHANT_TYPE_CODES = new Set(MERCHANT_ACCOUNT_TYPES.map((type) => type.code));

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  credited: "default",
  rejected: "secondary",
  duplicate: "secondary",
  error: "destructive",
};

// A receiving account row in the form. `_id` is a client-only stable key so
// removing a row doesn't reshuffle React state across the others; it never gets
// sent to the server.
type ReceiverRow = {
  _id: number;
  account_type: string;
  account_number: string;
  account_name_th: string;
  account_name_en: string;
};

let nextRowId = 1;
function emptyRow(): ReceiverRow {
  return { _id: nextRowId++, account_type: "", account_number: "", account_name_th: "", account_name_en: "" };
}

// The stored jsonb is an array of {account_type, account_number, ...}; tolerate a
// bad/absent value rather than throwing in render.
function rowsFromStored(value: unknown): ReceiverRow[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const r = (item ?? {}) as Record<string, unknown>;
    return {
      _id: nextRowId++,
      account_type: typeof r.account_type === "string" ? r.account_type : "",
      account_number: typeof r.account_number === "string" ? r.account_number : "",
      account_name_th: typeof r.account_name_th === "string" ? r.account_name_th : "",
      account_name_en: typeof r.account_name_en === "string" ? r.account_name_en : "",
    };
  });
}

export default function PaymentSettingsPage() {
  const { profile } = useAuth();
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [apiSecret, setApiSecret] = useState("");
  const [receivers, setReceivers] = useState<ReceiverRow[]>([]);

  // Seed the form from the server exactly once so a background refetch (e.g. React
  // Query's refetch-on-window-focus) can't clobber unsaved edits.
  const seeded = useRef(false);

  const { data: shop } = useQuery({
    queryKey: ["shop-payment-settings", profile?.shop_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shops")
        .select("slip2go_api_secret, slip_receivers")
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
      setApiSecret(shop.slip2go_api_secret ?? "");
      setReceivers(rowsFromStored(shop.slip_receivers));
    }
  }, [shop]);

  const save = useMutation({
    mutationFn: async () => {
      // Drop rows the user never filled and strip the client-only _id before
      // sending; the edge function re-validates and rejects half-filled rows.
      const slip_receivers = receivers
        .filter((r) => r.account_type.trim() || r.account_number.trim())
        .map((r) => ({
          account_type: r.account_type.trim(),
          account_number: r.account_number.trim(),
          account_name_th: r.account_name_th.trim(),
          account_name_en: r.account_name_en.trim(),
        }));
      const { error } = await supabase.functions.invoke("update-shop-payment-settings", {
        body: { slip2go_api_secret: apiSecret, slip_receivers },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("pay.saved"));
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

  function updateRow(id: number, patch: Partial<ReceiverRow>) {
    setReceivers((rows) => rows.map((r) => (r._id === id ? { ...r, ...patch } : r)));
  }

  function removeRow(id: number) {
    setReceivers((rows) => rows.filter((r) => r._id !== id));
  }

  // Upload a shop's merchant QR (KShop, แม่มณี, Thai QR Payment) and pull the
  // Merchant ID straight out of it, so the merchant never has to hunt for a
  // number the account doesn't visibly have. The extracted value is what Slip2Go
  // matches on (KShop verified against a live slip; confirm แม่มณี once).
  const qrInputRef = useRef<HTMLInputElement>(null);
  async function handleQrFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // let the same file be re-picked after an error
    if (!file) return;
    try {
      const payload = await decodeQrFromFile(file);
      if (!payload) {
        toast.error(t("pay.qrNoCode"));
        return;
      }
      const receiver = extractKShopReceiver(payload);
      if (!receiver) {
        toast.error(t("pay.qrNoMerchant"));
        return;
      }
      setReceivers((rows) => [
        ...rows,
        {
          _id: nextRowId++,
          account_type: receiver.account_type,
          account_number: receiver.account_number,
          account_name_th: "",
          account_name_en: receiver.account_name_en,
        },
      ]);
      toast.success(t("pay.qrAdded", { name: receiver.account_name_en || receiver.account_number }));
    } catch {
      toast.error(t("pay.qrError"));
    }
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
      <PageHeader title={t("pay.title")} subtitle={t("pay.subtitle")} />

      <Card>
        <CardHeader>
          <CardTitle>{t("pay.slip2go")}</CardTitle>
          <CardDescription>
            {t("pay.apiSecretHintPrefix")}
            <a
              href="https://slip2go.com"
              target="_blank"
              rel="noreferrer"
              className="text-primary underline"
            >
              Slip2Go
            </a>
            {t("pay.apiSecretHintSuffix")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex max-w-3xl flex-col gap-4" onSubmit={handleSubmit}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="slip2go_api_secret">{t("pay.apiSecret")}</Label>
              <Input
                id="slip2go_api_secret"
                type="password"
                value={apiSecret}
                onChange={(e) => setApiSecret(e.target.value)}
              />
            </div>

            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {t("pay.warning")}
            </div>

            <div className="flex flex-col gap-1">
              <Label>{t("pay.receivers")}</Label>
              <p className="text-sm text-muted-foreground">{t("pay.receiversHint")}</p>
            </div>

            {receivers.map((row, index) => (
              <div key={row._id} className="rounded-md border border-border bg-muted/30 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm font-medium">
                    {t("pay.accountLabel", { n: String(index + 1) })}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => removeRow(row._id)}
                  >
                    <Trash2 className="size-4" />
                    <span className="sr-only sm:not-sr-only sm:ml-1">{t("pay.removeAccount")}</span>
                  </Button>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor={`account_type_${row._id}`}>{t("pay.accountType")}</Label>
                    <Select
                      value={row.account_type}
                      onValueChange={(value) => updateRow(row._id, { account_type: value })}
                    >
                      <SelectTrigger id={`account_type_${row._id}`} className="w-full min-w-0">
                        <SelectValue placeholder={t("pay.selectAccountType")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectLabel>{t("pay.merchantGroup")}</SelectLabel>
                          {MERCHANT_ACCOUNT_TYPES.map((type) => (
                            <SelectItem key={type.code} value={type.code}>
                              {type.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                        <SelectGroup>
                          <SelectLabel>{t("pay.banksGroup")}</SelectLabel>
                          {THAI_BANKS.map((bank) => (
                            <SelectItem key={bank.code} value={bank.code}>
                              {bank.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor={`account_number_${row._id}`}>
                      {MERCHANT_TYPE_CODES.has(row.account_type) ? t("pay.merchantId") : t("pay.accountNumber")}
                    </Label>
                    <Input
                      id={`account_number_${row._id}`}
                      autoComplete="off"
                      placeholder={
                        MERCHANT_TYPE_CODES.has(row.account_type) ? t("pay.merchantIdPlaceholder") : undefined
                      }
                      value={row.account_number}
                      onChange={(e) => updateRow(row._id, { account_number: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor={`account_name_th_${row._id}`}>{t("pay.accountNameTh")}</Label>
                    <Input
                      id={`account_name_th_${row._id}`}
                      value={row.account_name_th}
                      onChange={(e) => updateRow(row._id, { account_name_th: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor={`account_name_en_${row._id}`}>{t("pay.accountNameEn")}</Label>
                    <Input
                      id={`account_name_en_${row._id}`}
                      value={row.account_name_en}
                      onChange={(e) => updateRow(row._id, { account_name_en: e.target.value })}
                    />
                  </div>
                </div>
              </div>
            ))}

            <input
              ref={qrInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleQrFile}
            />
            <div className="flex flex-col gap-2 sm:flex-row sm:self-start">
              <Button
                type="button"
                variant="secondary"
                className="w-full sm:w-auto"
                onClick={() => qrInputRef.current?.click()}
              >
                <QrCode className="size-4" />
                {t("pay.uploadQr")}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto"
                onClick={() => setReceivers((rows) => [...rows, emptyRow()])}
              >
                <Plus className="size-4" />
                {t("pay.addAccount")}
              </Button>
            </div>

            <Button type="submit" disabled={save.isPending} className="w-full sm:w-auto sm:self-start">
              {save.isPending ? t("common.saving") : t("common.save")}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("pay.recentVerifications")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.date")}</TableHead>
                <TableHead>{t("pay.sender")}</TableHead>
                <TableHead>{t("pay.bank")}</TableHead>
                <TableHead>{t("pay.amount")}</TableHead>
                <TableHead>{t("common.status")}</TableHead>
                <TableHead className="text-right">{t("common.points")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {verificationsLoading && (
                <TableRow>
                  <TableCell colSpan={6}>{t("common.loading")}</TableCell>
                </TableRow>
              )}
              {verifications?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    {t("pay.noSlips")}
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
