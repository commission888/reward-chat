import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/i18n/LanguageProvider";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function CustomersPage() {
  const { t } = useI18n();
  const { data: customers, isLoading } = useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, display_name, picture_url, phone, points_balance, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{t("customers.title")}</h1>
        <p className="text-muted-foreground">{t("customers.subtitle")}</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t("customers.all")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.name")}</TableHead>
                <TableHead>{t("common.phone")}</TableHead>
                <TableHead className="text-right">{t("common.points")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={3}>{t("common.loading")}</TableCell>
                </TableRow>
              )}
              {customers?.map((customer) => (
                <TableRow key={customer.id}>
                  <TableCell className="font-medium">
                    <Link
                      to={`/customers/${customer.id}`}
                      className="flex items-center gap-2 text-primary underline-offset-4 hover:underline"
                    >
                      <Avatar className="size-8">
                        <AvatarImage src={customer.picture_url ?? undefined} alt="" />
                        <AvatarFallback>
                          {(customer.display_name ?? "?").slice(0, 1).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      {customer.display_name ?? t("customers.unnamed")}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{customer.phone ?? "—"}</TableCell>
                  <TableCell className="text-right">{customer.points_balance}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
