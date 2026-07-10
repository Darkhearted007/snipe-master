-- LP mint resolved from the pool-creation transaction's account layout
-- (see resolveLpMint in src/lib/pool-discovery.ts). NULL means either the
-- venue has no separate LP mint concept (pump.fun bonding curve) or
-- resolution failed — distinguished from a resolved-but-unlocked LP by the
-- safety pipeline's lpStatus field inside raw_payload, not by this column
-- alone.
alter table public.discovery_candidates
  add column if not exists lp_mint text;
