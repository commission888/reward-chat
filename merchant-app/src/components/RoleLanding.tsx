import { Navigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";

export default function RoleLanding() {
  const { profile } = useAuth();
  if (profile?.role === "super_admin") return <Navigate to="/admin/shops" replace />;
  return <Navigate to="/dashboard" replace />;
}
