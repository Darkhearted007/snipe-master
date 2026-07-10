-- Pool/token discovery candidates, populated by the Helius webhook handler
-- at /api/webhooks/helius-pool-discovery. Serverless-safe replacement for a
-- persistent logsSubscribe WebSocket: Helius pushes us an HTTP POST when a
-- watched program (Raydium AMM v4 / CPMM / Pump.fun) logs a pool-creation
-- instruction, and we upsert the newly seen mint here.

create table if not exists public.discovery_candidates (
  mint text primary key,
  decimals int not null,
  venue text not null,
  symbol text not null,
  discovery_signature text not null,
  discovered_at timestamptz not null default now(),
  -- Populated later by the safety pipeline; NULL means "not yet checked" —
  -- the frontend must treat unchecked candidates as unsafe, never default-safe.
  safety_score int,
  liquidity_usd numeric,
  raw_payload jsonb
);

create index if not exists discovery_candidates_discovered_at_idx
  on public.discovery_candidates (discovered_at desc);

-- Auto-expire candidates the same way the in-memory PoolDiscoveryFeed did
-- (maxCandidateAgeMs = 30 min) so stale, never-traded launches don't pile up.
create or replace function public.prune_stale_discovery_candidates()
returns void
language sql
as $$
  delete from public.discovery_candidates
  where discovered_at < now() - interval '30 minutes';
$$;

alter table public.discovery_candidates enable row level security;

-- Service role (server routes) does all writes; authenticated app users can
-- only read. No anon/public access — this data feeds live trading decisions.
create policy "discovery_candidates_read_authenticated"
  on public.discovery_candidates for select
  to authenticated
  using (true);
