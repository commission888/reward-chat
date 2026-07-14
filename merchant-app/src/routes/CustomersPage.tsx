import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function CustomersPage() {
  const { data: customers, isLoading } = useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, display_name, phone, points_balance, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Customers</h1>
        <p className="text-muted-foreground">Everyone enrolled in your loyalty program.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>All customers</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead className="text-right">Points</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={3}>Loading...</TableCell>
                </TableRow>
              )}
              {customers?.map((customer) => (
                <TableRow key={customer.id}>
                  <TableCell className="font-medium">
                    <Link to={`/customers/${customer.id}`} className="hover:underline">
                      {customer.display_name ?? "Unnamed"}
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
