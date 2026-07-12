import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "viewer" | "trader" | "admin";

export function useAuthSession() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    let mounted = true;
    let settled = false;
    const settle = (s: Session | null) => {
      if (!mounted || settled) return;
      settled = true;
      setSession(s);
    };

    supabase.auth
      .getSession()
      .then(({ data }) => settle(data.session ?? null))
      .catch((err) => {
        console.warn("[auth] getSession failed", err);
        settle(null);
      });

    // Safety net: never leave the app stuck on "Loading session…"
    const to = window.setTimeout(() => {
      if (!settled) {
        console.warn("[auth] getSession timed out; treating as signed out");
        settle(null);
      }
    }, 3000);

    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      settled = true;
      if (mounted) setSession(s);
    });
    return () => {
      mounted = false;
      window.clearTimeout(to);
      sub.subscription.unsubscribe();
    };
  }, []);

  return session; // undefined = loading, null = signed out, Session = signed in
}


export function useCurrentRoles(userId: string | undefined) {
  return useQuery({
    queryKey: ["roles", userId],
    enabled: !!userId,
    queryFn: async (): Promise<AppRole[]> => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId!);
      if (error) throw error;
      return (data ?? []).map((r) => r.role as AppRole);
    },
    staleTime: 30_000,
  });
}

export function useHasRole(role: AppRole | AppRole[]) {
  const session = useAuthSession();
  const { data: roles } = useCurrentRoles(session?.user.id);
  const needed = Array.isArray(role) ? role : [role];
  return {
    ready: session !== undefined && (!session || !!roles),
    allowed: !!roles?.some((r) => needed.includes(r)),
    roles: roles ?? [],
    session,
  };
}
