import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getFunctionErrorMessage } from "@rewardchat/shared";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/i18n/LanguageProvider";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function StaffPage() {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "staff">("staff");

  const { data: staff, isLoading } = useQuery({
    queryKey: ["staff"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, role, created_at")
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });

  const createStaff = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.functions.invoke("create-staff-user", {
        body: { full_name: fullName, email, password, role },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("staff.created"));
      setFullName("");
      setEmail("");
      setPassword("");
      setRole("staff");
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ["staff"] });
    },
    onError: (error) => {
      void getFunctionErrorMessage(error).then((message) => toast.error(message));
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    createStaff.mutate();
  }

  // Lifted out of the JSX below rather than inlined into PageHeader's actions
  // slot: it's ~45 lines of form, and nesting that inside a prop buries the
  // page's actual structure under it.
  const newAccountDialog = (
    <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>{t("staff.newAccount")}</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("staff.createTitle")}</DialogTitle>
            </DialogHeader>
            <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
              <div className="flex flex-col gap-2">
                <Label htmlFor="full-name">{t("common.fullName")}</Label>
                <Input id="full-name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">{t("common.email")}</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="password">{t("staff.tempPassword")}</Label>
                <Input
                  id="password"
                  type="password"
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label>{t("common.role")}</Label>
                <Select value={role} onValueChange={(value) => setRole(value as "admin" | "staff")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="staff">{t("staff.roleStaff")}</SelectItem>
                    <SelectItem value="admin">{t("staff.roleAdmin")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" disabled={createStaff.isPending}>
                {createStaff.isPending ? t("common.creating") : t("staff.createAccount")}
              </Button>
            </form>
          </DialogContent>
    </Dialog>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("staff.title")} subtitle={t("staff.subtitle")} actions={newAccountDialog} />
      <Card>
        <CardHeader>
          <CardTitle>{t("staff.team")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.name")}</TableHead>
                <TableHead>{t("common.email")}</TableHead>
                <TableHead>{t("common.role")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={3}>{t("common.loading")}</TableCell>
                </TableRow>
              )}
              {staff?.map((member) => (
                <TableRow key={member.id}>
                  <TableCell className="font-medium">{member.full_name}</TableCell>
                  <TableCell className="text-muted-foreground">{member.email}</TableCell>
                  <TableCell>
                    <Badge variant={member.role === "admin" ? "default" : "secondary"}>{member.role}</Badge>
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
