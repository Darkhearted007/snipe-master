import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "viewer" | "trader" | "admin";

function readPersistedSupabaseSession(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    const ref = url?.match(/https?:\/\/([^.]+)\./)?.[1];
    const keys = ref
      ? [`sb-${ref}-auth-token`]
      : Array.from({ length: window.localStorage.length }, (_, i) =>
          window.localStorage.key(i) ?? "",
        ).filter((key) => key.startsWith("sb-") && key.endsWith("-auth-token"));

    for (const key of keys) {
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as Session & {
        expires_at?: number;
        currentSession?: Session & { expires_at?: number };
      };
      const session = parsed.currentSession ?? parsed;
      if (session?.expires_at && session.expires_at * 1000 < Date.now()) continue;
      if (session?.access_token) return session as Session;
    }
  } catch {
    return null;
  }
  return null;
}

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
  // Keep the first client render identical to SSR. The persisted session is
  // still read immediately after hydration below, which avoids both the blank
  // skeleton hang and React's full-tree hydration recovery.
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    let mounted = true;
    let initialResolved = false;
    // Seed lastKnown from the synchronous localStorage read so a transient
    // SIGNED_OUT (token-refresh race) fired before getSession() resolves
    // does NOT bounce the user back to /auth on first mount.
    const persistedAtMount = readPersistedSupabaseSession();
    let lastKnown: Session | null = persistedAtMount;

    const commit = (s: Session | null) => {
      if (!mounted) return;
      if (s) lastKnown = s;
      setSession(s);
    };

    // Resolve the gate on the first post-hydration tick from browser storage,
    // then let getSession() reconcile/refresh in the background.
    window.queueMicrotask(() => {
      if (!initialResolved && mounted) commit(persistedAtMount);
    });

    // Safety net: never leave the UI stuck on the skeleton. Register this
    // BEFORE touching the auth client so even a synchronous client-init error
    // resolves the gate and lets the /auth route render.
    const to = window.setTimeout(() => {
      if (!initialResolved && mounted) {
        const s = readPersistedSupabaseSession();
        if (s) console.warn("[auth] getSession slow; using persisted session");
        else console.warn("[auth] getSession slow; no persisted session");
        commit(s);
      }
    }, 700);

    Promise.resolve()
      .then(() => supabase.auth.getSession())
      .then(({ data }) => {
        if (!mounted) return;
        initialResolved = true;
        // If getSession() returns null but storage still holds a non-expired
        // token, trust storage — this is the refresh-race window.
        const s = data.session ?? readPersistedSupabaseSession();
        commit(s);
      })
      .catch((err) => {
        console.warn("[auth] getSession failed", err);
        if (!mounted) return;
        initialResolved = true;
        commit(readPersistedSupabaseSession());
      });


    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (!mounted) return;
      initialResolved = true;

      // Any event that carries a session is authoritative.
      if (s) {
        commit(s);
        return;
      }

      // No session on the event. Distinguish a real sign-out from the
      // transient SIGNED_OUT that Supabase emits during a failed token
      // refresh: on a real sign-out the SDK clears its localStorage entry
      // first, so if the persisted token is still there we're mid-refresh
      // and must ignore the event to avoid bouncing the operator back to
      // the auth page while the bot is running.
      const storageStillHasToken = (() => {
        try {
          return !!readPersistedSupabaseSession();
        } catch {
          return false;
        }
      })();

      if (event === "SIGNED_OUT" && !storageStillHasToken) {
        lastKnown = null;
        commit(null);
        return;
      }

      // Transient null (refresh race, or SIGNED_OUT with token still
      // persisted). If we've ever held a valid session, keep the UI
      // signed-in; the next event will reconcile.
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
