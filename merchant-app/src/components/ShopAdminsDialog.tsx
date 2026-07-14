import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Trash2 } from "lucide-react";
import { getFunctionErrorMessage } from "@rewardchat/shared";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Shop = { id: string; name: string };
type Admin = { id: string; full_name: string | null; email: string | null };

export default function ShopAdminsDialog({
  shop,
  onOpenChange,
}: {
  shop: Shop | null;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const shopId = shop?.id ?? null;
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["shop-admins", shopId] });

  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addEmail, setAddEmail] = useState("");
  const [addPassword, setAddPassword] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPassword, setEditPassword] = useState("");

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const { data: admins, isLoading } = useQuery({
    queryKey: ["shop-admins", shopId],
    enabled: shopId !== null,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .eq("shop_id", shopId as string)
        .eq("role", "admin")
        .order("full_name");
      if (error) throw error;
      return data as Admin[];
    },
  });

  const addAdmin = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.functions.invoke("create-shop-admin", {
        body: { shop_id: shopId, full_name: addName, email: addEmail, password: addPassword },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Admin added");
      setAddName("");
      setAddEmail("");
      setAddPassword("");
      setAddOpen(false);
      invalidate();
    },
    onError: (error) => {
      void getFunctionErrorMessage(error).then((message) => toast.error(message));
    },
  });

  const updateAdmin = useMutation({
    mutationFn: async () => {
      if (!editingId) return;
      // Omit `password` entirely when the field is left blank — sending "" would
      // trip the server's min-length check and block a legitimate email/name edit.
      const body: Record<string, string> = { user_id: editingId, full_name: editName, email: editEmail };
      if (editPassword.trim().length > 0) body.password = editPassword;
      const { error } = await supabase.functions.invoke("update-shop-admin", { body });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Admin updated");
      setEditingId(null);
      setEditPassword("");
      invalidate();
    },
    onError: (error) => {
      void getFunctionErrorMessage(error).then((message) => toast.error(message));
    },
  });

  const deleteAdmin = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.functions.invoke("delete-shop-admin", { body: { user_id: id } });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Admin removed");
      setConfirmDeleteId(null);
      invalidate();
    },
    onError: (error) => {
      void getFunctionErrorMessage(error).then((message) => toast.error(message));
    },
  });

  function startEdit(admin: Admin) {
    setEditingId(admin.id);
    setEditName(admin.full_name ?? "");
    setEditEmail(admin.email ?? "");
    setEditPassword("");
    setConfirmDeleteId(null);
  }

  function handleAdd(event: FormEvent) {
    event.preventDefault();
    if (!addName.trim() || !addEmail.trim() || addPassword.length < 8) return;
    addAdmin.mutate();
  }

  function handleEditSave(event: FormEvent) {
    event.preventDefault();
    if (!editName.trim() || !editEmail.trim()) return;
    updateAdmin.mutate();
  }

  return (
    <Dialog open={shop !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Admins — {shop?.name}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
          {!isLoading && admins?.length === 0 && (
            <p className="text-sm text-muted-foreground">No admins yet. Add one below.</p>
          )}

          {admins?.map((admin) => (
            <div key={admin.id} className="rounded-md border p-3">
              {editingId === admin.id ? (
                <form className="flex flex-col gap-2" onSubmit={handleEditSave}>
                  <Label htmlFor={`name-${admin.id}`}>Full name</Label>
                  <Input
                    id={`name-${admin.id}`}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    required
                  />
                  <Label htmlFor={`email-${admin.id}`}>Email</Label>
                  <Input
                    id={`email-${admin.id}`}
                    type="email"
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    required
                  />
                  <Label htmlFor={`pass-${admin.id}`}>
                    New password <span className="text-muted-foreground">(leave blank to keep)</span>
                  </Label>
                  <Input
                    id={`pass-${admin.id}`}
                    type="password"
                    minLength={8}
                    value={editPassword}
                    onChange={(e) => setEditPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                  <div className="flex justify-end gap-2 pt-1">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setEditingId(null)}
                      disabled={updateAdmin.isPending}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" disabled={updateAdmin.isPending}>
                      {updateAdmin.isPending ? "Saving..." : "Save"}
                    </Button>
                  </div>
                </form>
              ) : confirmDeleteId === admin.id ? (
                <div className="flex flex-col gap-2">
                  <p className="text-sm">
                    Remove <span className="font-medium">{admin.full_name || admin.email}</span>? This permanently
                    deletes their login.
                  </p>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setConfirmDeleteId(null)} disabled={deleteAdmin.isPending}>
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => deleteAdmin.mutate(admin.id)}
                      disabled={deleteAdmin.isPending}
                    >
                      {deleteAdmin.isPending ? "Removing..." : "Remove"}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{admin.full_name || "—"}</p>
                    <p className="truncate text-sm text-muted-foreground">{admin.email}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button variant="ghost" size="icon" aria-label="Edit admin" onClick={() => startEdit(admin)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Delete admin"
                      onClick={() => {
                        setConfirmDeleteId(admin.id);
                        setEditingId(null);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {addOpen ? (
            <form className="flex flex-col gap-2 rounded-md border border-dashed p-3" onSubmit={handleAdd}>
              <Label htmlFor="add-name">Full name</Label>
              <Input id="add-name" value={addName} onChange={(e) => setAddName(e.target.value)} required />
              <Label htmlFor="add-email">Email</Label>
              <Input
                id="add-email"
                type="email"
                value={addEmail}
                onChange={(e) => setAddEmail(e.target.value)}
                required
              />
              <Label htmlFor="add-pass">Temporary password</Label>
              <Input
                id="add-pass"
                type="password"
                minLength={8}
                value={addPassword}
                onChange={(e) => setAddPassword(e.target.value)}
                required
              />
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="outline" onClick={() => setAddOpen(false)} disabled={addAdmin.isPending}>
                  Cancel
                </Button>
                <Button type="submit" disabled={addAdmin.isPending}>
                  {addAdmin.isPending ? "Adding..." : "Add admin"}
                </Button>
              </div>
            </form>
          ) : (
            <Button variant="outline" onClick={() => setAddOpen(true)}>
              + Add admin
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
