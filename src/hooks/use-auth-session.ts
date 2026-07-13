import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "viewer" | "trader" | "admin";

/**
 * Session hook with sticky semantics.
 *
 * Design contract: once we have observed a valid session, we treat it as
 * sticky. Transient `null`s produced by token-refresh races (SIGNED_OUT
 * events fired mid-refresh when many parallel authenticated calls collide)
 * MUST NOT bounce the operator back to the sign-in page while the bot is
 * running. Only the explicit `SIGNED_OUT` event that follows an actual
 * `supabase.auth.signOut()` call, or a fresh mount that never sees a
 * session, is allowed to resolve to `null`.
 *
 * Returns:
 *   undefined = still loading (first check hasn't resolved)
 *   null      = definitively signed out
 *   Session   = signed in (sticky — persists across transient refresh nulls)
 */
export function useAuthSession() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    let mounted = true;
    let initialResolved = false;
    let lastKnown: Session | null = null;

    const commit = (s: Session | null) => {
      if (!mounted) return;
      if (s) lastKnown = s;
      setSession(s);
    };

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!mounted) return;
        initialResolved = true;
        commit(data.session ?? null);
      })
      .catch((err) => {
        console.warn("[auth] getSession failed", err);
        if (!mounted) return;
        initialResolved = true;
        commit(null);
      });

    // Safety net: never leave the UI stuck on "Loading session…"
    const to = window.setTimeout(() => {
      if (!initialResolved && mounted) {
        console.warn("[auth] getSession slow; provisionally treating as signed out");
        initialResolved = true;
        commit(null);
      }
    }, 4000);

    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (!mounted) return;
      initialResolved = true;

      // Explicit sign-out event — always honored.
      if (event === "SIGNED_OUT") {
        lastKnown = null;
        commit(null);
        return;
      }

      // Any other event that carries a session is authoritative.
      if (s) {
        commit(s);
        return;
      }

      // Event without a session and it's NOT SIGNED_OUT. This is the
      // transient token-refresh race. If we've ever held a valid session,
      // ignore the null and keep the UI signed-in; the next event will
      // reconcile.
      if (lastKnown) {
        console.debug("[auth] ignoring transient null on", event);
        return;
      }
      commit(null);
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
