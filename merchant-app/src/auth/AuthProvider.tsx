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
    // Tracks the currently signed-in user so we can tell a real identity change
    // (login/logout) apart from a background token refresh for the same user.
    let currentUserId: string | null = null;

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
      currentUserId = data.session?.user.id ?? null;
      setSession(data.session);
      loadProfile(data.session);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      // supabase-js re-fires SIGNED_IN on tab refocus and TOKEN_REFRESHED
      // periodically. Flipping `loading` back to true on those would unmount
      // the whole app (AppShell shows a full-screen loader while loading),
      // wiping any unsaved form state on every background refresh. Only raise
      // the loader when the signed-in identity actually changes (login/logout).
      const nextUserId = nextSession?.user.id ?? null;
      if (nextUserId !== currentUserId) {
        currentUserId = nextUserId;
        setLoading(true);
      }
      setSession(nextSession);
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
