import { useState } from "react";
import { NavLink, Outlet, Navigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";
import { useI18n } from "@/i18n/LanguageProvider";
import { LanguageToggle } from "@/components/LanguageToggle";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type NavItem = { to: string; labelKey: string };

const NAV_BY_ROLE: Record<string, NavItem[]> = {
  super_admin: [{ to: "/admin/shops", labelKey: "nav.shops" }],
  admin: [
    { to: "/dashboard", labelKey: "nav.dashboard" },
    { to: "/staff", labelKey: "nav.staff" },
    { to: "/customers", labelKey: "nav.customers" },
    { to: "/rewards", labelKey: "nav.rewards" },
    { to: "/redemptions", labelKey: "nav.redemptions" },
    { to: "/knowledge-base", labelKey: "nav.knowledgeBase" },
    { to: "/settings/ai", labelKey: "nav.aiSettings" },
    { to: "/settings/line", labelKey: "nav.lineSettings" },
    { to: "/settings/payments", labelKey: "nav.paymentSettings" },
  ],
  staff: [
    { to: "/dashboard", labelKey: "nav.dashboard" },
    { to: "/scan", labelKey: "nav.scan" },
    { to: "/customers", labelKey: "nav.customers" },
    { to: "/redemptions", labelKey: "nav.redemptions" },
  ],
};

export default function AppShell() {
  const { session, profile, loading, signOut } = useAuth();
  const { t } = useI18n();
  const [mobileOpen, setMobileOpen] = useState(false);

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-base text-muted-foreground">{t("common.loading")}</div>;
  }

  if (!session || !profile) {
    return <Navigate to="/login" replace />;
  }

  const navItems = NAV_BY_ROLE[profile.role] ?? [];

  const sidebarInner = (
    <>
      <div className="mb-8 px-2">
        <p className="text-xl font-semibold text-foreground">RewardChat</p>
        <p className="truncate text-sm text-muted-foreground">{profile.full_name ?? profile.email}</p>
      </div>
      <nav className="flex flex-1 flex-col gap-1">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) =>
              cn(
                "rounded-lg px-3 py-2.5 text-base font-medium transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-foreground hover:bg-accent hover:text-accent-foreground"
              )
            }
          >
            {t(item.labelKey)}
          </NavLink>
        ))}
      </nav>
      <div className="flex flex-col gap-3">
        <LanguageToggle className="w-full justify-center" />
        <Button variant="outline" onClick={() => signOut()}>
          {t("common.signOut")}
        </Button>
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 flex-col border-r border-border bg-card px-4 py-6 lg:flex">
        {sidebarInner}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-foreground/30" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 flex h-full w-64 max-w-[82%] flex-col border-r border-border bg-card px-4 py-6 shadow-xl">
            {sidebarInner}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="flex items-center gap-3 border-b border-border bg-card px-4 py-3 lg:hidden">
          <button
            type="button"
            aria-label={t("app.openMenu")}
            onClick={() => setMobileOpen(true)}
            className="inline-flex size-10 items-center justify-center rounded-lg text-foreground hover:bg-accent"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="4" y1="6" x2="20" y2="6" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="18" x2="20" y2="18" />
            </svg>
          </button>
          <p className="text-lg font-semibold text-foreground">RewardChat</p>
          <LanguageToggle className="ml-auto" />
        </header>

        {/* The page measure lives here, once, rather than in 13 routes. Without
            it every screen ran the full width of the monitor, so a table on a
            27" display stretched its columns to opposite edges and the eye had
            to travel the whole desk to read one row. `mx-auto` keeps the block
            centred in the remaining space beside the sidebar. */}
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-page p-5 sm:p-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
