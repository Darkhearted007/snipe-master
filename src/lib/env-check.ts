/**
 * Startup env validation for the Supabase client.
 *
 * The generated Supabase client throws when either VITE_SUPABASE_URL or
 * VITE_SUPABASE_PUBLISHABLE_KEY is missing. That throw bubbles up through
 * every hook that touches `supabase` (persistence, wallet, council…) and
 * blows up the error boundary with a scary "This section stopped responding"
 * card. This helper lets us detect the condition BEFORE any consumer runs
 * and render a single, clear configuration screen instead.
 */

export type SupabaseEnvStatus =
  | { ok: true; url: string; key: string }
  | { ok: false; missing: string[] };

// Publishable (anon) fallbacks — safe to ship in client bundle. These are
// used ONLY if Vite fails to inline the env vars at build time, so the app
// never relapses into the "Backend configuration missing" screen.
import { FALLBACK_SUPABASE_URL, FALLBACK_SUPABASE_PUBLISHABLE_KEY } from "@/lib/supabase-fallback";
const FALLBACK_URL = FALLBACK_SUPABASE_URL;
const FALLBACK_KEY = FALLBACK_SUPABASE_PUBLISHABLE_KEY;

export function getSupabaseEnvStatus(): SupabaseEnvStatus {
  const url =
    (typeof import.meta !== "undefined" && import.meta.env?.VITE_SUPABASE_URL) ||
    (typeof process !== "undefined" && process.env?.SUPABASE_URL) ||
    FALLBACK_URL;
  const key =
    (typeof import.meta !== "undefined" && import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY) ||
    (typeof process !== "undefined" && process.env?.SUPABASE_PUBLISHABLE_KEY) ||
    FALLBACK_KEY;

  const missing: string[] = [];
  if (!url) missing.push("SUPABASE_URL");
  if (!key) missing.push("SUPABASE_PUBLISHABLE_KEY");

  if (missing.length) return { ok: false, missing };
  return { ok: true, url, key };
}
