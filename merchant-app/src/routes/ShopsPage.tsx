import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MoreHorizontal } from "lucide-react";
import { getFunctionErrorMessage } from "@rewardchat/shared";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import ShopAdminsDialog from "@/components/ShopAdminsDialog";

type Shop = { id: string; name: string; slug: string; created_at: string };

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export default function ShopsPage() {
  const queryClient = useQueryClient();
  const invalidateShops = () => queryClient.invalidateQueries({ queryKey: ["shops"] });

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");

  // The shop each per-row dialog is acting on (null = closed).
  const [manageShop, setManageShop] = useState<Shop | null>(null);
  const [renameShop, setRenameShop] = useState<Shop | null>(null);
  const [deleteShop, setDeleteShop] = useState<Shop | null>(null);

  const [renameName, setRenameName] = useState("");

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
      toast.success("Shop created");
      setName("");
      setCreateOpen(false);
      invalidateShops();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const renameShopMutation = useMutation({
    mutationFn: async () => {
      if (!renameShop) return;
      const trimmed = renameName.trim();
      const { error } = await supabase
        .from("shops")
        .update({ name: trimmed, slug: slugify(trimmed) })
        .eq("id", renameShop.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Shop renamed");
      setRenameShop(null);
      invalidateShops();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteShopMutation = useMutation({
    mutationFn: async () => {
      if (!deleteShop) return;
      const { error } = await supabase.functions.invoke("delete-shop", {
        body: { shop_id: deleteShop.id },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Shop deleted");
      setDeleteShop(null);
      invalidateShops();
    },
    onError: (error) => {
      void getFunctionErrorMessage(error).then((message) => toast.error(message));
    },
  });

  function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    createShop.mutate(name.trim());
  }

  function handleRename(event: FormEvent) {
    event.preventDefault();
    if (!renameName.trim()) return;
    renameShopMutation.mutate();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Shops</h1>
          <p className="text-muted-foreground">Manage every tenant on the platform.</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>New shop</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create shop</DialogTitle>
            </DialogHeader>
            <form className="flex flex-col gap-4" onSubmit={handleCreate}>
              <div className="flex flex-col gap-2">
                <Label htmlFor="shop-name">Shop name</Label>
                <Input id="shop-name" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <Button type="submit" disabled={createShop.isPending}>
                {createShop.isPending ? "Creating..." : "Create shop"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>All shops</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead className="w-12 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={3}>Loading...</TableCell>
                </TableRow>
              )}
              {shops?.map((shop) => (
                <TableRow key={shop.id}>
                  <TableCell className="font-medium">{shop.name}</TableCell>
                  <TableCell className="text-muted-foreground">{shop.slug}</TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label={`Actions for ${shop.name}`}>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setManageShop(shop)}>Manage admins</DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => {
                            setRenameName(shop.name);
                            setRenameShop(shop);
                          }}
                        >
                          Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onSelect={() => setDeleteShop(shop)}
                        >
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Manage admins (list / add / edit / delete) */}
      <ShopAdminsDialog shop={manageShop} onOpenChange={(open) => !open && setManageShop(null)} />

      {/* Rename */}
      <Dialog open={renameShop !== null} onOpenChange={(open) => !open && setRenameShop(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename shop</DialogTitle>
          </DialogHeader>
          <form className="flex flex-col gap-4" onSubmit={handleRename}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="rename-name">Shop name</Label>
              <Input id="rename-name" value={renameName} onChange={(e) => setRenameName(e.target.value)} required />
            </div>
            <Button type="submit" disabled={renameShopMutation.isPending}>
              {renameShopMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={deleteShop !== null} onOpenChange={(open) => !open && setDeleteShop(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleteShop?.name}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This permanently deletes the shop and everything under it — its admin/staff accounts, customers, points
            history, loyalty cards, and knowledge base. This cannot be undone.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleteShop(null)} disabled={deleteShopMutation.isPending}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteShopMutation.mutate()}
              disabled={deleteShopMutation.isPending}
            >
              {deleteShopMutation.isPending ? "Deleting..." : "Delete shop"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
