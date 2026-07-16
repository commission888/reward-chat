import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronLeft } from "lucide-react";
import { getFunctionErrorMessage } from "@rewardchat/shared";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/i18n/LanguageProvider";
import { PageHeader } from "@/components/PageHeader";
import ShopAdmins from "@/components/ShopAdmins";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// One shop, opened by clicking its row. Everything that used to hide behind the
// list's "..." menu lives here in the open: who the admins are (previously a
// modal inside a popover), and the two shop-level actions.
//
// Delete keeps a dialog — it destroys the tenant and everything under it, so
// interrupting is the point. Rename keeps one because it's a single field that
// doesn't warrant restructuring the page around it. Neither hides information;
// they confirm an action, which is what a dialog is actually for.
type Shop = { id: string; name: string; slug: string };

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export default function ShopDetailPage() {
  const { shopId } = useParams();
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [renameOpen, setRenameOpen] = useState(false);
  const [renameName, setRenameName] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);

  const { data: shop, isLoading } = useQuery({
    queryKey: ["shop", shopId],
    enabled: Boolean(shopId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shops")
        .select("id, name, slug")
        .eq("id", shopId as string)
        .maybeSingle();
      if (error) throw error;
      return (data as Shop | null) ?? null;
    },
  });

  const renameShop = useMutation({
    mutationFn: async () => {
      const trimmed = renameName.trim();
      const { error } = await supabase
        .from("shops")
        .update({ name: trimmed, slug: slugify(trimmed) })
        .eq("id", shopId as string);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("shops.renamed"));
      setRenameOpen(false);
      queryClient.invalidateQueries({ queryKey: ["shop", shopId] });
      queryClient.invalidateQueries({ queryKey: ["shops"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteShop = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.functions.invoke("delete-shop", { body: { shop_id: shopId } });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("shops.deleted"));
      queryClient.invalidateQueries({ queryKey: ["shops"] });
      // The record this page is about no longer exists — staying would render a
      // "not found" against the name we just deleted.
      navigate("/admin/shops", { replace: true });
    },
    onError: (error) => {
      void getFunctionErrorMessage(error).then((message) => toast.error(message));
    },
  });

  const backLink = (
    <Link
      to="/admin/shops"
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ChevronLeft className="h-4 w-4" />
      {t("shops.backToShops")}
    </Link>
  );

  if (isLoading) {
    return <p className="text-muted-foreground">{t("common.loading")}</p>;
  }

  if (!shop) {
    return (
      <div className="flex flex-col gap-4">
        {backLink}
        <p className="text-muted-foreground">{t("shops.notFound")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        {backLink}
        <PageHeader
          title={shop.name}
          subtitle={shop.slug}
          actions={
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setRenameName(shop.name);
                  setRenameOpen(true);
                }}
              >
                {t("shops.rename")}
              </Button>
              <Button variant="outline" className="text-destructive" onClick={() => setDeleteOpen(true)}>
                {t("shops.delete")}
              </Button>
            </>
          }
        />
      </div>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-foreground">{t("admins.sectionTitle")}</h2>
        <ShopAdmins shop={shop} />
      </section>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("shops.renameTitle")}</DialogTitle>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              if (!renameName.trim()) return;
              renameShop.mutate();
            }}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="rename-name">{t("shops.shopName")}</Label>
              <Input id="rename-name" value={renameName} onChange={(e) => setRenameName(e.target.value)} required />
            </div>
            <Button type="submit" disabled={renameShop.isPending}>
              {renameShop.isPending ? t("common.saving") : t("common.save")}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("shops.deleteTitle", { name: shop.name })}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t("shops.deleteWarning")}</p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleteShop.isPending}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" onClick={() => deleteShop.mutate()} disabled={deleteShop.isPending}>
              {deleteShop.isPending ? t("shops.deleting") : t("shops.deleteShop")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
