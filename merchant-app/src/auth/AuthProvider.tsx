import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import type { Role } from "@rewardchat/shared";

type Profile = {
  id: string;
  shop_id: string | null;
  role: Role;
  full_name: string | null;
  email: string | null;
};

type AuthState = {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    // getSession() and onAuthStateChange's INITIAL_SESSION event commonly
    // both fire near-simultaneously on mount, and a fast sign-out/sign-in
    // can start a second load before the first resolves. Only apply the
    // result of the *latest* requested load, regardless of which promise
    // settles last.
    let requestId = 0;

    async function loadProfile(nextSession: Session | null) {
      const thisRequestId = ++requestId;
      if (!nextSession) {
        if (active && thisRequestId === requestId) {
          setProfile(null);
          setLoading(false);
        }
        return;
      }
      const { data, error } = await supabase
        .from("profiles")
        .select("id, shop_id, role, full_name, email")
        .eq("id", nextSession.user.id)
        .single();
      if (!active || thisRequestId !== requestId) return;
      if (error) {
        setProfile(null);
      } else {
        setProfile(data as Profile);
      }
      setLoading(false);
    }

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      loadProfile(data.session);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(true);
      loadProfile(nextSession);
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
  }

  return (
    <AuthContext.Provider value={{ session, profile, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
