// Admin RPCs — every function verifies the caller has the `admin` role
// via the SECURITY DEFINER `has_role` RPC before doing anything.
// Role writes go through the caller's RLS-scoped client so the
// `admins manage roles` policy authorises them; user listing joins
// `profiles` + `user_roles` (both readable by any authenticated user
// under current policies) so we don't need service-role for reads.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ROLE_VALUES = ["viewer", "trader", "admin"] as const;
type AppRole = (typeof ROLE_VALUES)[number];

const roleMutationInput = z.object({
  userId: z.string().uuid(),
  role: z.enum(ROLE_VALUES),
});

async function assertAdmin(supabase: SupabaseClient, callerId: string) {
  // Direct read against user_roles under RLS ("users view own roles") — the
  // has_role SECURITY DEFINER helper now lives in a private schema and is
  // not reachable via PostgREST.
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", callerId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(`role check failed: ${error.message}`);
  if (!data) throw new Error("Forbidden: admin role required");
}


export type AdminUserRow = {
  id: string;
  walletAddress: string;
  displayName: string | null;
  createdAt: string;
  roles: AppRole[];
};

export const listAdminUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminUserRow[]> => {
    const { supabase, userId } = context as {
      supabase: SupabaseClient;
      userId: string;
    };
    await assertAdmin(supabase, userId);

    const [{ data: profiles, error: pErr }, { data: roles, error: rErr }] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, wallet_address, display_name, created_at")
        .order("created_at", { ascending: false })
        .limit(500),
      supabase.from("user_roles").select("user_id, role"),
    ]);
    if (pErr) throw new Error(pErr.message);
    if (rErr) throw new Error(rErr.message);

    const byUser = new Map<string, AppRole[]>();
    for (const r of roles ?? []) {
      const arr = byUser.get(r.user_id) ?? [];
      arr.push(r.role as AppRole);
      byUser.set(r.user_id, arr);
    }
    return (profiles ?? []).map((p) => ({
      id: p.id,
      walletAddress: p.wallet_address,
      displayName: p.display_name,
      createdAt: p.created_at,
      roles: byUser.get(p.id) ?? [],
    }));
  });

export const grantRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => roleMutationInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as {
      supabase: SupabaseClient;
      userId: string;
    };
    await assertAdmin(supabase, userId);
    // idempotent upsert on (user_id, role)
    const { error } = await supabase
      .from("user_roles")
      .upsert(
        { user_id: data.userId, role: data.role },
        { onConflict: "user_id,role", ignoreDuplicates: true },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const revokeRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => roleMutationInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as {
      supabase: SupabaseClient;
      userId: string;
    };
    await assertAdmin(supabase, userId);
    // Never let an admin revoke their own last admin role — lockout guard.
    if (data.userId === userId && data.role === "admin") {
      const { data: admins, error: cErr } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "admin");
      if (cErr) throw new Error(cErr.message);
      if ((admins?.length ?? 0) <= 1) {
        throw new Error("Cannot revoke the last admin — assign another admin first");
      }
    }
    const { error } = await supabase
      .from("user_roles")
      .delete()
      .eq("user_id", data.userId)
      .eq("role", data.role);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
