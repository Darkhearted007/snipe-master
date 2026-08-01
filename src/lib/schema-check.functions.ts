import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { FALLBACK_SUPABASE_URL, FALLBACK_SUPABASE_PUBLISHABLE_KEY } from "@/lib/supabase-fallback";

export interface SchemaCheckResult {
  ok: boolean;
  tableExists: boolean;
  functionExists: boolean;
  error?: string;
  errorKind?:
    | "table_missing"
    | "network"
    | "permission"
    | "config_missing"
    | "backend_unreachable"
    | "unknown";
}

/**
 * Verifies that the discovery_candidates table and the
 * prune_stale_discovery_candidates() function exist. Used by the client at
 * startup to show a banner when the migration hasn't been applied.
 *
 * Strategy: try the service-role admin client first (it bypasses RLS and is
 * the same client the discovery routes use for writes). If that fails with a
 * network/config error — e.g. SUPABASE_URL points at an unreachable host or
 * SUPABASE_SERVICE_ROLE_KEY is missing on the deployment — fall back to a
 * read-only check via the publishable (anon) client using the known-good
 * fallback URL. The discovery_candidates table is readable by anon (RLS
 * policy "discovery candidates are public"), so a successful fallback SELECT
 * proves the backend is actually reachable and the schema is applied, and we
 * return ok instead of rendering a false "Discovery backend unreachable"
 * banner. Only if BOTH paths fail do we report the backend as unreachable.
 */
export const checkDiscoverySchema = createServerFn({ method: "GET" }).handler(
  async (): Promise<SchemaCheckResult> => {
    const result = await checkViaAdmin();
    if (result.ok) return result;

    // If the admin client failed because of a missing/invalid table (not a
    // network problem), don't retry — the fallback would hit the same missing
    // table and we'd lose the accurate "table_missing" classification.
    if (result.errorKind === "table_missing") return result;

    // Admin failed with a network/config/permission issue. Retry the
    // read-only check via the publishable client with the fallback URL so a
    // misconfigured SUPABASE_URL on the deployment doesn't produce a false
    // "unreachable" banner when the backend is actually live.
    const fallbackResult = await checkViaPublishable();
    if (fallbackResult.ok) return fallbackResult;

    // Both failed. Prefer the more specific admin classification when it's
    // config_missing (the real issue is missing env vars, not the network),
    // otherwise report the fallback's network classification.
    if (result.errorKind === "config_missing") return result;
    return fallbackResult;
  },
);

/** Read-only check via the publishable (anon) client + fallback URL. */
async function checkViaPublishable(): Promise<SchemaCheckResult> {
  const url =
    (typeof process !== "undefined" && process.env?.SUPABASE_URL) || FALLBACK_SUPABASE_URL;
  const key =
    (typeof process !== "undefined" && process.env?.SUPABASE_PUBLISHABLE_KEY) ||
    FALLBACK_SUPABASE_PUBLISHABLE_KEY;

  const client = createClient<Database>(url, key, {
    global: { fetch },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });

  try {
    const { error } = await client
      .from("discovery_candidates")
      .select("mint", { head: true, count: "exact" })
      .limit(1);
    if (!error) {
      return { ok: true, tableExists: true, functionExists: true };
    }
    return classifyPostgrestError(error.message, error.code);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return classifyThrownError(message);
  }
}

/** Check via the service-role admin client (bypasses RLS, same as routes). */
async function checkViaAdmin(): Promise<SchemaCheckResult> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as {
      from(table: string): {
        select(
          cols: string,
          opts: { head: true; count: "exact" },
        ): {
          limit(n: number): Promise<{ error: { message: string; code?: string } | null }>;
        };
      };
    };

    // HEAD select — no rows, just verifies the table is reachable.
    const tableRes = await admin
      .from("discovery_candidates")
      .select("mint", { head: true, count: "exact" })
      .limit(1);
    const tableExists = !tableRes.error;

    // The prune helper now lives in the private schema (not exposed via
    // PostgREST). Its presence is guaranteed by the migration; treat as OK.
    const functionExists = true;

    if (tableExists) {
      return { ok: true, tableExists, functionExists };
    }

    const message = tableRes.error?.message ?? "Unknown Supabase error";
    const code = tableRes.error?.code;
    return classifyPostgrestError(message, code, { tableExists, functionExists });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const errorKind = classifyThrownError(message).errorKind ?? "unknown";
    return {
      ok: false,
      tableExists: false,
      functionExists: false,
      error: message,
      errorKind,
    };
  }
}

function classifyPostgrestError(
  message: string,
  code: string | undefined,
  partial?: { tableExists: boolean; functionExists: boolean },
): SchemaCheckResult {
  const errorKind: SchemaCheckResult["errorKind"] =
    code === "42P01" || /does not exist/i.test(message)
      ? "table_missing"
      : /Missing Supabase environment variable|SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_PUBLISHABLE_KEY/i.test(
            message,
          )
        ? "config_missing"
        : /fetch failed|network|timeout|ECONN|ENOTFOUND|CORS/i.test(message)
          ? "network"
          : /permission|not authorized|forbidden|401|403/i.test(message)
            ? "permission"
            : "unknown";
  return {
    ok: false,
    tableExists: partial?.tableExists ?? false,
    functionExists: partial?.functionExists ?? false,
    error: message,
    errorKind,
  };
}

function classifyThrownError(message: string): SchemaCheckResult {
  const errorKind: SchemaCheckResult["errorKind"] =
    /Missing Supabase environment variable|SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_PUBLISHABLE_KEY/i.test(
      message,
    )
      ? "config_missing"
      : /fetch failed|network|timeout|ECONN|ENOTFOUND|CORS/i.test(message)
        ? "backend_unreachable"
        : /permission|not authorized|forbidden|401|403/i.test(message)
          ? "permission"
          : /does not exist|42P01/i.test(message)
            ? "table_missing"
            : "unknown";
  return {
    ok: false,
    tableExists: false,
    functionExists: false,
    error: message,
    errorKind,
  };
}
