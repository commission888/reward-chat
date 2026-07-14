import { QRCodeSVG } from "qrcode.react";
import { useCustomer } from "@/customer/CustomerProvider";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

export default function CardPage() {
  const { customer, qrToken, shop, loading, error, refresh } = useCustomer();

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6">
        <Skeleton className="h-40 w-72 rounded-xl" />
        <p className="text-sm text-muted-foreground">Joining {shop?.name ?? "the"} loyalty program...</p>
      </div>
    );
  }

  if (error || !customer || !qrToken) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center">
        <p className="text-sm text-destructive">{error ?? "Something went wrong."}</p>
        <Button onClick={() => refresh()}>Try again</Button>
      </div>
    );
  }

  const initials = (customer.display_name ?? "?").slice(0, 1).toUpperCase();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-6">
      <div className="text-center">
        <p className="text-sm font-medium text-muted-foreground">{shop?.name ?? "Loyalty Card"}</p>
      </div>

      <Card className="w-full max-w-sm">
        <CardHeader className="flex flex-row items-center gap-3">
          <Avatar>
            <AvatarImage src={customer.picture_url ?? undefined} alt={customer.display_name ?? "Customer"} />
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <div>
            <p className="font-medium text-foreground">{customer.display_name ?? "Member"}</p>
            <p className="text-sm text-muted-foreground">{customer.points_balance} points</p>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4 pb-8">
          <div className="rounded-xl border border-border bg-card p-4">
            <QRCodeSVG value={qrToken} size={200} fgColor="#0F172A" bgColor="#FFFFFF" />
          </div>
          <p className="text-center text-xs text-muted-foreground">
            Show this code to staff to earn or redeem points.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
