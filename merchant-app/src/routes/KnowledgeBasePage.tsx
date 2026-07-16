import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabaseClient";
import { extractText } from "@/lib/extractText";
import { useAuth } from "@/auth/AuthProvider";
import { useI18n } from "@/i18n/LanguageProvider";
import { PageHeader } from "@/components/PageHeader";
import { KNOWLEDGE_FILES_BUCKET, getFunctionErrorMessage } from "@rewardchat/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  pending: "secondary",
  processing: "secondary",
  completed: "default",
  failed: "destructive",
};

export default function KnowledgeBasePage() {
  const { profile } = useAuth();
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const { data: files, isLoading } = useQuery({
    queryKey: ["files"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("files")
        .select("id, original_name, status, error_message, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    refetchInterval: 4000,
  });

  const uploadFile = useMutation({
    mutationFn: async (file: File) => {
      if (!profile?.shop_id) throw new Error(t("kb.noShopContext"));
      const text = await extractText(file);
      const fileId = crypto.randomUUID();
      const storagePath = `${profile.shop_id}/${fileId}/${file.name}`;

      const { error: uploadError } = await supabase.storage.from(KNOWLEDGE_FILES_BUCKET).upload(storagePath, file);
      if (uploadError) throw uploadError;

      const { error: insertError } = await supabase.from("files").insert({
        id: fileId,
        shop_id: profile.shop_id,
        storage_path: storagePath,
        original_name: file.name,
        mime_type: file.type,
        uploaded_by: profile.id,
        status: "pending",
      });
      if (insertError) throw insertError;

      const { error: ingestError } = await supabase.functions.invoke("ingest-file", {
        body: { file_id: fileId, text },
      });
      if (ingestError) throw ingestError;
    },
    onSuccess: () => {
      toast.success(t("kb.uploadedToast"));
      queryClient.invalidateQueries({ queryKey: ["files"] });
    },
    onError: (error) => {
      void getFunctionErrorMessage(error).then((message) => toast.error(message));
    },
    onSettled: () => setUploading(false),
  });

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    uploadFile.mutate(file);
    event.target.value = "";
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("kb.title")}
        subtitle={t("kb.subtitle")}
        actions={
          <>
            {/* Hidden on purpose — the visible control is the Button beside it,
                which forwards the click. Kept adjacent to that Button so the two
                halves of one control don't drift apart. */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".docx,.xlsx"
              className="hidden"
              onChange={handleFileChange}
            />
            <Button onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              {uploading ? t("kb.uploading") : t("kb.upload")}
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>{t("kb.files")}</CardTitle>
          <CardDescription>{t("kb.processingHint")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.name")}</TableHead>
                <TableHead>{t("common.status")}</TableHead>
                <TableHead>{t("kb.uploaded")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={3}>{t("common.loading")}</TableCell>
                </TableRow>
              )}
              {files?.map((file) => (
                <TableRow key={file.id}>
                  <TableCell className="font-medium">{file.original_name}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[file.status] ?? "secondary"}>{file.status}</Badge>
                    {file.status === "failed" && file.error_message && (
                      <p className="mt-1 text-xs text-destructive">{file.error_message}</p>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(file.created_at).toLocaleString()}
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
