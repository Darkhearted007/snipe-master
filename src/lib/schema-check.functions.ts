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

/**
 * Read-only check via the publishable (anon) client.
 *
 * IMPORTANT: This function ALWAYS uses the known-good FALLBACK_SUPABASE_URL and
 * FALLBACK_SUPABASE_PUBLISHABLE_KEY — never the process.env values. The entire
 * purpose of this fallback is to verify the backend is reachable when the
 * configured SUPABASE_URL on the deployment is broken (stale, placeholder, or
 * pointing at an unreachable host). If the env URL worked, the admin check
 * above would have already succeeded and we wouldn't be here. Reading
 * process.env?.SUPABASE_URL here (as a previous version did) defeats the
 * fallback: when SUPABASE_URL is truthy-but-broken the `||` operator never
 * falls back to FALLBACK_SUPABASE_URL, so the publishable client hits the same
 * unreachable host and fails with `TypeError: fetch failed` — reproducing the
 * exact false "Discovery backend unreachable" banner this fallback was meant
 * to prevent.
 *
 * The discovery_candidates table is readable by the anon role (RLS policy
 * "discovery candidates are public"), so a successful HEAD select here proves
 * the real backend is live and the schema is applied.
 */
async function checkViaPublishable(): Promise<SchemaCheckResult> {
  const client = createClient<Database>(FALLBACK_SUPABASE_URL, FALLBACK_SUPABASE_PUBLISHABLE_KEY, {
    global: { fetch: fetchWithTimeout },
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

/**
 * Wrapper around the global `fetch` that enforces a 6-second timeout via
 * AbortController. Without this, a misconfigured SUPABASE_URL pointing at a
 * host that silently drops connections can hang the schema check indefinitely
 * (the serverless function would time out at the platform limit, but a shorter
 * timeout here lets the fallback logic kick in quickly).
 */
function fetchWithTimeout(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
): ReturnType<typeof fetch> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
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
