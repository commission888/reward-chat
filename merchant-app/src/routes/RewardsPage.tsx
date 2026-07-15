import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getFunctionErrorMessage } from "@rewardchat/shared";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/auth/AuthProvider";
import { useI18n } from "@/i18n/LanguageProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Reward = {
  id: string;
  name: string;
  description: string | null;
  points_cost: number;
  active: boolean;
};

export default function RewardsPage() {
  const { profile } = useAuth();
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const shopId = profile?.shop_id ?? null;
  const [form, setForm] = useState({ name: "", description: "", points_cost: "" });
  // null while unloaded; "" means "no minimum".
  const [threshold, setThreshold] = useState<string | null>(null);

  const { data: pointsConfig } = useQuery({
    queryKey: ["shop-points-config", shopId],
    queryFn: async () => {
      const { data, error } = await supabase.from("shops").select("points_config").eq("id", shopId!).single();
      if (error) throw error;
      return (data.points_config ?? {}) as { redeem_threshold?: number };
    },
    enabled: Boolean(shopId),
  });

  const thresholdValue = threshold ?? (pointsConfig?.redeem_threshold?.toString() ?? "");

  const saveThreshold = useMutation({
    mutationFn: async () => {
      const raw = thresholdValue.trim();
      const parsed = raw === "" ? null : Number(raw);
      if (parsed !== null && (!Number.isInteger(parsed) || parsed < 0)) {
        throw new Error(t("rewards.errThreshold"));
      }
      // points_config also carries the slip-crediting rules, so this goes
      // through an edge function that merges rather than overwrites it.
      const { error } = await supabase.functions.invoke("update-shop-points-settings", {
        body: { redeem_threshold: parsed },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("rewards.thresholdSaved"));
      setThreshold(null);
      queryClient.invalidateQueries({ queryKey: ["shop-points-config", shopId] });
    },
    onError: (error) => {
      void getFunctionErrorMessage(error, t("rewards.errThreshold")).then((m) => toast.error(m));
    },
  });

  const { data: rewards, isLoading } = useQuery({
    queryKey: ["rewards", shopId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rewards")
        .select("id, name, description, points_cost, active")
        .eq("shop_id", shopId!)
        .order("points_cost", { ascending: true });
      if (error) throw error;
      return data as Reward[];
    },
    enabled: Boolean(shopId),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["rewards", shopId] });

  const create = useMutation({
    mutationFn: async () => {
      const cost = Number(form.points_cost);
      const { error } = await supabase.from("rewards").insert({
        shop_id: shopId!,
        name: form.name.trim(),
        description: form.description.trim() || null,
        points_cost: cost,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("rewards.added"));
      setForm({ name: "", description: "", points_cost: "" });
      invalidate();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : t("rewards.errAdd")),
  });

  const toggleActive = useMutation({
    mutationFn: async (reward: Reward) => {
      const { error } = await supabase.from("rewards").update({ active: !reward.active }).eq("id", reward.id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (error) => toast.error(error instanceof Error ? error.message : t("rewards.errUpdate")),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("rewards").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("rewards.deleted"));
      invalidate();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : t("rewards.errDelete")),
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const cost = Number(form.points_cost);
    if (!form.name.trim()) {
      toast.error(t("rewards.errName"));
      return;
    }
    if (!Number.isInteger(cost) || cost <= 0) {
      toast.error(t("rewards.errPoints"));
      return;
    }
    create.mutate();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{t("rewards.title")}</h1>
        <p className="text-muted-foreground">{t("rewards.subtitle")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("rewards.thresholdTitle")}</CardTitle>
          <CardDescription>{t("rewards.thresholdHint")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="threshold">{t("rewards.thresholdLabel")}</Label>
            <Input
              id="threshold"
              type="number"
              min={0}
              className="w-40"
              placeholder={t("rewards.thresholdNone")}
              value={thresholdValue}
              onChange={(e) => setThreshold(e.target.value)}
            />
          </div>
          <Button type="button" onClick={() => saveThreshold.mutate()} disabled={saveThreshold.isPending}>
            {saveThreshold.isPending ? t("common.saving") : t("common.save")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("rewards.addTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            <div className="flex flex-wrap gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="name">{t("common.name")}</Label>
                <Input
                  id="name"
                  className="w-64"
                  placeholder={t("rewards.namePlaceholder")}
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="points_cost">{t("rewards.pointsCost")}</Label>
                <Input
                  id="points_cost"
                  type="number"
                  className="w-40"
                  placeholder={t("rewards.pointsPlaceholder")}
                  value={form.points_cost}
                  onChange={(e) => setForm((f) => ({ ...f, points_cost: e.target.value }))}
                />
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="description">{t("rewards.description")}</Label>
              <Input
                id="description"
                className="w-full max-w-xl"
                placeholder={t("rewards.descriptionPlaceholder")}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            <Button type="submit" disabled={create.isPending} className="self-start">
              {create.isPending ? t("rewards.adding") : t("rewards.addButton")}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("rewards.yours")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.name")}</TableHead>
                <TableHead>{t("rewards.pointsCol")}</TableHead>
                <TableHead>{t("common.status")}</TableHead>
                <TableHead className="text-right">{t("common.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={4}>{t("common.loading")}</TableCell>
                </TableRow>
              )}
              {!isLoading && (rewards?.length ?? 0) === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground">
                    {t("rewards.empty")}
                  </TableCell>
                </TableRow>
              )}
              {rewards?.map((reward) => (
                <TableRow key={reward.id}>
                  <TableCell>
                    <div className="font-medium text-foreground">{reward.name}</div>
                    {reward.description && (
                      <div className="text-sm text-muted-foreground">{reward.description}</div>
                    )}
                  </TableCell>
                  <TableCell>{reward.points_cost}</TableCell>
                  <TableCell>
                    <Badge variant={reward.active ? "default" : "secondary"}>
                      {reward.active ? t("rewards.active") : t("rewards.hidden")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => toggleActive.mutate(reward)}
                        disabled={toggleActive.isPending}
                      >
                        {reward.active ? t("rewards.hide") : t("rewards.show")}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => remove.mutate(reward.id)}
                        disabled={remove.isPending}
                      >
                        {t("rewards.deleteButton")}
                      </Button>
                    </div>
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
