/**
 * Shared Supabase fallback configuration.
 *
 * The generated browser client (src/integrations/supabase/client.ts) and
 * vite.config.ts already fall back to these values when VITE_* / process.env
 * vars are absent, so the client-side app keeps working on preview
 * deployments that don't have env vars wired up.
 *
 * The server-side admin client (client.server.ts) historically had NO
 * fallback — it threw "Missing Supabase environment variable(s)" when
 * SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY were unset, and when SUPABASE_URL
 * WAS set but pointed at an unreachable host (a stale/placeholder value on a
 * Vercel project) the admin client surfaced `TypeError: fetch failed`
 * (ENOTFOUND). That network error bubbled up through checkDiscoverySchema and
 * rendered a persistent "Discovery backend unreachable" banner even though the
 * real Supabase project (these fallback values) was live and the
 * discovery_candidates table was readable.
 *
 * These publishable values are safe to ship in any bundle — they only grant
 * anon (RLS-gated) read access, exactly what the schema-check HEAD select and
 * the client need. Writes still require the real SUPABASE_SERVICE_ROLE_KEY.
 */
export const FALLBACK_SUPABASE_URL = "https://wqpykfbacsczqvvigaqr.supabase.co";
export const FALLBACK_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_9CcocmqcwnlO84vCVvrSKg_g2RrxgGG";
