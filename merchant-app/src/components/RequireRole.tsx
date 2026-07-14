import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";
import type { Role } from "@rewardchat/shared";

export default function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { profile } = useAuth();
  if (!profile || !roles.includes(profile.role)) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}
