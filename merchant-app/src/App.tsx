import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { LanguageProvider } from "@/i18n/LanguageProvider";
import { AuthProvider } from "@/auth/AuthProvider";
import AppShell from "@/components/AppShell";
import RequireRole from "@/components/RequireRole";
import RoleLanding from "@/components/RoleLanding";
import LoginPage from "@/routes/LoginPage";
import DashboardPage from "@/routes/DashboardPage";
import ShopsPage from "@/routes/ShopsPage";
import StaffPage from "@/routes/StaffPage";
import CustomersPage from "@/routes/CustomersPage";
import CustomerDetailPage from "@/routes/CustomerDetailPage";
import ScanPage from "@/routes/ScanPage";
import KnowledgeBasePage from "@/routes/KnowledgeBasePage";
import AiSettingsPage from "@/routes/AiSettingsPage";
import LineSettingsPage from "@/routes/LineSettingsPage";
import PaymentSettingsPage from "@/routes/PaymentSettingsPage";
import RewardsPage from "@/routes/RewardsPage";
import RedemptionsPage from "@/routes/RedemptionsPage";

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<AppShell />}>
              <Route index element={<RoleLanding />} />
              <Route
                path="/dashboard"
                element={
                  <RequireRole roles={["admin", "staff"]}>
                    <DashboardPage />
                  </RequireRole>
                }
              />
              <Route
                path="/admin/shops"
                element={
                  <RequireRole roles={["super_admin"]}>
                    <ShopsPage />
                  </RequireRole>
                }
              />
              <Route
                path="/staff"
                element={
                  <RequireRole roles={["admin"]}>
                    <StaffPage />
                  </RequireRole>
                }
              />
              <Route
                path="/customers"
                element={
                  <RequireRole roles={["admin", "staff"]}>
                    <CustomersPage />
                  </RequireRole>
                }
              />
              <Route
                path="/customers/:customerId"
                element={
                  <RequireRole roles={["admin", "staff"]}>
                    <CustomerDetailPage />
                  </RequireRole>
                }
              />
              <Route
                path="/scan"
                element={
                  <RequireRole roles={["staff", "admin"]}>
                    <ScanPage />
                  </RequireRole>
                }
              />
              <Route
                path="/rewards"
                element={
                  <RequireRole roles={["admin"]}>
                    <RewardsPage />
                  </RequireRole>
                }
              />
              <Route
                path="/redemptions"
                element={
                  <RequireRole roles={["admin", "staff"]}>
                    <RedemptionsPage />
                  </RequireRole>
                }
              />
              <Route
                path="/knowledge-base"
                element={
                  <RequireRole roles={["admin"]}>
                    <KnowledgeBasePage />
                  </RequireRole>
                }
              />
              <Route
                path="/settings/ai"
                element={
                  <RequireRole roles={["admin"]}>
                    <AiSettingsPage />
                  </RequireRole>
                }
              />
              <Route
                path="/settings/line"
                element={
                  <RequireRole roles={["admin"]}>
                    <LineSettingsPage />
                  </RequireRole>
                }
              />
              <Route
                path="/settings/payments"
                element={
                  <RequireRole roles={["admin"]}>
                    <PaymentSettingsPage />
                  </RequireRole>
                }
              />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
      </LanguageProvider>
      <Toaster />
    </QueryClientProvider>
  );
}

export default App;
