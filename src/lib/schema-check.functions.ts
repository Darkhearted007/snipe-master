import { createServerFn } from "@tanstack/react-start";

export interface SchemaCheckResult {
  ok: boolean;
  tableExists: boolean;
  functionExists: boolean;
  error?: string;
}

/**
 * Verifies that the discovery_candidates table and the
 * prune_stale_discovery_candidates() function exist. Used by the client at
 * startup to show a banner when the migration hasn't been applied.
 */
export const checkDiscoverySchema = createServerFn({ method: "GET" }).handler(
  async (): Promise<SchemaCheckResult> => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const admin = supabaseAdmin as unknown as {
        from(table: string): {
          select(cols: string, opts: { head: true; count: "exact" }): {
            limit(n: number): Promise<{ error: { message: string; code?: string } | null }>;
          };
        };
        rpc(fn: string, args?: Record<string, unknown>): Promise<{
          error: { message: string; code?: string } | null;
        }>;
      };

      // HEAD select — no rows, just verifies the table is reachable.
      const tableRes = await admin
        .from("discovery_candidates")
        .select("mint", { head: true, count: "exact" })
        .limit(1);
      const tableExists = !tableRes.error;

      const rpcRes = await admin.rpc("prune_stale_discovery_candidates");
      // Missing function → PostgREST returns PGRST202 / "Could not find the function".
      const msg = rpcRes.error?.message ?? "";
      const functionExists = !rpcRes.error || !/could not find the function|does not exist/i.test(msg);

      return {
        ok: tableExists && functionExists,
        tableExists,
        functionExists,
        error: tableRes.error?.message ?? (functionExists ? undefined : msg),
      };
    } catch (e) {
      return {
        ok: false,
        tableExists: false,
        functionExists: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
);
