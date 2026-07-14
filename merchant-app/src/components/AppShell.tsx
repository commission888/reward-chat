import { NavLink, Outlet, Navigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type NavItem = { to: string; label: string };

const NAV_BY_ROLE: Record<string, NavItem[]> = {
  super_admin: [{ to: "/admin/shops", label: "Shops" }],
  admin: [
    { to: "/dashboard", label: "Dashboard" },
    { to: "/staff", label: "Staff" },
    { to: "/customers", label: "Customers" },
    { to: "/rewards", label: "Rewards" },
    { to: "/redemptions", label: "Redemptions" },
    { to: "/knowledge-base", label: "Knowledge Base" },
    { to: "/settings/line", label: "LINE Settings" },
    { to: "/settings/payments", label: "Payment Settings" },
  ],
  staff: [
    { to: "/dashboard", label: "Dashboard" },
    { to: "/scan", label: "Scan" },
    { to: "/customers", label: "Customers" },
    { to: "/redemptions", label: "Redemptions" },
  ],
};

export default function AppShell() {
  const { session, profile, loading, signOut } = useAuth();

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Loading...</div>;
  }

  if (!session || !profile) {
    return <Navigate to="/login" replace />;
  }

  const navItems = NAV_BY_ROLE[profile.role] ?? [];

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="flex w-56 flex-col border-r border-border bg-card px-4 py-6">
        <div className="mb-8 px-2">
          <p className="text-lg font-semibold text-foreground">RewardChat</p>
          <p className="text-xs text-muted-foreground">{profile.full_name ?? profile.email}</p>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-foreground hover:bg-accent hover:text-accent-foreground"
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <Button variant="outline" size="sm" onClick={() => signOut()}>
          Sign out
        </Button>
      </aside>
      <main className="flex-1 overflow-y-auto p-8">
        <Outlet />
      </main>
    </div>
  );
}
