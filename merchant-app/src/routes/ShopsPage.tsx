import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/i18n/LanguageProvider";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

// A list, and nothing else. Opening a shop is a click on its name — the same
// move as CustomersPage → CustomerDetailPage — instead of a "..." menu whose
// three items each opened a different modal on top of the list. Managing a shop
// happens on the shop's own page, where there's room to show it.
type Shop = { id: string; name: string; slug: string; created_at: string };

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export default function ShopsPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const invalidateShops = () => queryClient.invalidateQueries({ queryKey: ["shops"] });

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");

  const { data: shops, isLoading } = useQuery({
    queryKey: ["shops"],
    queryFn: async () => {
      const { data, error } = await supabase.from("shops").select("id, name, slug, created_at").order("created_at");
      if (error) throw error;
      return data as Shop[];
    },
  });

  const createShop = useMutation({
    mutationFn: async (shopName: string) => {
      const { error } = await supabase.from("shops").insert({ name: shopName, slug: slugify(shopName) });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("shops.created"));
      setName("");
      setCreateOpen(false);
      invalidateShops();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    createShop.mutate(name.trim());
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("shops.title")}
        subtitle={t("shops.subtitle")}
        actions={
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button>{t("shops.newShop")}</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("shops.createTitle")}</DialogTitle>
              </DialogHeader>
              <form className="flex flex-col gap-4" onSubmit={handleCreate}>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="shop-name">{t("shops.shopName")}</Label>
                  <Input id="shop-name" value={name} onChange={(e) => setName(e.target.value)} required />
                </div>
                <Button type="submit" disabled={createShop.isPending}>
                  {createShop.isPending ? t("common.creating") : t("shops.createShop")}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>{t("shops.all")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.name")}</TableHead>
                <TableHead>{t("shops.slug")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={2}>{t("common.loading")}</TableCell>
                </TableRow>
              )}
              {shops?.map((shop) => (
                <TableRow key={shop.id}>
                  <TableCell className="font-medium">
                    <Link
                      to={`/admin/shops/${shop.id}`}
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      {shop.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{shop.slug}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
