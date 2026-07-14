import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getFunctionErrorMessage } from "@rewardchat/shared";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function LineSettingsPage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    line_channel_id: "",
    line_channel_secret: "",
    line_channel_access_token: "",
    liff_id: "",
  });

  // Seed the form from the server exactly once. A background refetch (e.g. React
  // Query's refetch-on-window-focus when the admin tabs back after copying a value
  // from the LINE console) must not clobber whatever they've typed but not saved yet.
  const seeded = useRef(false);

  const { data: shop } = useQuery({
    queryKey: ["shop", profile?.shop_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shops")
        .select("id, name, line_channel_id, line_channel_secret, line_channel_access_token, liff_id")
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
        line_channel_id: shop.line_channel_id ?? "",
        line_channel_secret: shop.line_channel_secret ?? "",
        line_channel_access_token: shop.line_channel_access_token ?? "",
        liff_id: shop.liff_id ?? "",
      });
    }
  }, [shop]);

  const save = useMutation({
    mutationFn: async () => {
      // Writes to `shops` go through this edge function (service role) rather
      // than a direct client update: RLS only lets super_admin write `shops`
      // directly, so this is the admin's write path for their own LINE config.
      const { error } = await supabase.functions.invoke("update-shop-line-settings", {
        body: form,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("LINE settings saved");
      queryClient.invalidateQueries({ queryKey: ["shop", profile?.shop_id] });
    },
    onError: (error) => {
      void getFunctionErrorMessage(error).then((message) => toast.error(message));
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  const webhookUrl = profile?.shop_id
    ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/line-webhook/${profile.shop_id}`
    : "";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">LINE settings</h1>
        <p className="text-muted-foreground">Connect your shop's LINE Official Account and LIFF app.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Webhook URL</CardTitle>
          <CardDescription>Paste this into your LINE channel's Messaging API webhook settings.</CardDescription>
        </CardHeader>
        <CardContent>
          <code className="block break-all rounded-md bg-muted p-3 text-sm">{webhookUrl}</code>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Channel credentials</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="line_channel_id">Channel ID</Label>
              <Input
                id="line_channel_id"
                value={form.line_channel_id}
                onChange={(e) => setForm((f) => ({ ...f, line_channel_id: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="line_channel_secret">Channel secret</Label>
              <Input
                id="line_channel_secret"
                type="password"
                value={form.line_channel_secret}
                onChange={(e) => setForm((f) => ({ ...f, line_channel_secret: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="line_channel_access_token">Channel access token</Label>
              <Input
                id="line_channel_access_token"
                type="password"
                value={form.line_channel_access_token}
                onChange={(e) => setForm((f) => ({ ...f, line_channel_access_token: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="liff_id">LIFF ID</Label>
              <Input
                id="liff_id"
                value={form.liff_id}
                onChange={(e) => setForm((f) => ({ ...f, liff_id: e.target.value }))}
              />
            </div>
            <Button type="submit" disabled={save.isPending} className="self-start">
              {save.isPending ? "Saving..." : "Save"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
