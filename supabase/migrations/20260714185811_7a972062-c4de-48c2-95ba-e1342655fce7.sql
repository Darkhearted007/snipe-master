
CREATE TABLE IF NOT EXISTS public.discovery_candidates (
  mint TEXT PRIMARY KEY,
  lp_mint TEXT,
  decimals INTEGER NOT NULL DEFAULT 9,
  venue TEXT NOT NULL,
  symbol TEXT NOT NULL DEFAULT '',
  discovery_signature TEXT,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  safety_score NUMERIC,
  liquidity_usd NUMERIC,
  raw_payload JSONB
);

CREATE INDEX IF NOT EXISTS discovery_candidates_discovered_at_idx
  ON public.discovery_candidates (discovered_at DESC);
CREATE INDEX IF NOT EXISTS discovery_candidates_unscored_idx
  ON public.discovery_candidates (discovered_at)
  WHERE safety_score IS NULL;

GRANT ALL ON public.discovery_candidates TO service_role;

ALTER TABLE public.discovery_candidates ENABLE ROW LEVEL SECURITY;

-- No policies: table is service-role only (accessed via supabaseAdmin in server routes).

CREATE OR REPLACE FUNCTION public.prune_stale_discovery_candidates()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.discovery_candidates
   WHERE discovered_at < now() - INTERVAL '24 hours'
     AND safety_score IS NULL;
$$;

REVOKE ALL ON FUNCTION public.prune_stale_discovery_candidates() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prune_stale_discovery_candidates() TO service_role;
