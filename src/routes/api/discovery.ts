import { createFileRoute } from "@tanstack/react-router";
import { evaluateMintSafety } from "@/lib/onchain-safety";
import type { Json } from "@/integrations/supabase/types";

interface DiscoveryRow {
  mint: string;
  lp_mint: string | null;
  decimals: number;
  venue: string;
  symbol: string;
  discovered_at: string;
  safety_score: number | null;
  liquidity_usd: number | null;
  raw_payload?: Json;
}

interface DiscoveryQueryBuilder {
  select(columns: string): this;
  is(column: string, value: unknown): this;
  lt(column: string, value: unknown): this;
  order(column: string, opts: { ascending: boolean }): this;
  limit(
    n: number,
  ): Promise<{ data: DiscoveryRow[] | null; error: { message: string; code?: string } | null }>;
  update(values: Partial<DiscoveryRow>): {
    eq(
      column: string,
      value: unknown,
    ): Promise<{ error: { message: string; code?: string } | null }>;
  };
  delete(): {
    is(
      column: string,
      value: unknown,
    ): {
      lt(
        column: string,
        value: unknown,
      ): Promise<{ error: { message: string; code?: string } | null }>;
    };
  };
}

interface AdminClient {
  rpc(fn: string, args?: Record<string, unknown>): Promise<{ error: { message: string } | null }>;
  from(table: "discovery_candidates"): DiscoveryQueryBuilder;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
} as const;

const MAX_EVALUATIONS_PER_REQUEST = 3;
const DEX_QUERIES = ["SOL", "raydium", "pumpfun"] as const;

type DiscoveryDiagnostics = {
  stage: "supabase" | "fallback-dexscreener";
  reason: string;
  url?: string;
  status?: number;
  body?: string;
  stack?: string;
};

function mapDexVenue(dexId?: string): string {
  const d = (dexId ?? "").toLowerCase();
  // Only "pumpfun" is the bonding curve. "pumpswap" is the graduated AMM
  // — route it as raydium so Jupiter handles it (not the bonding-curve path).
  if (d === "pumpfun") return "solana/pump.fun";
  if (d.includes("pancake") || d.includes("bsc")) return "bsc";
  return "solana/raydium";
}

async function fetchDexScreenerFallbackCandidates(): Promise<DiscoveryRow[]> {
  const rows = new Map<string, DiscoveryRow>();

  const responses = await Promise.allSettled(
    DEX_QUERIES.map(async (query) => {
      const url = `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`;
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`DexScreener ${res.status} for ${url}: ${body.slice(0, 200)}`);
      }
      const data = (await res.json()) as {
        pairs?: Array<{
          chainId?: string;
          dexId?: string;
          baseToken?: { symbol?: string; address?: string };
          quoteToken?: { symbol?: string };
          liquidity?: { usd?: number };
          fdv?: number;
          marketCap?: number;
          pairCreatedAt?: number;
        }>;
      };
      return { query, data, url };
    }),
  );

  for (const response of responses) {
    if (response.status !== "fulfilled") continue;
    const { data } = response.value;
    for (const pair of data.pairs ?? []) {
      if (pair.chainId !== "solana" || !pair.baseToken?.address) continue;
      const mint = pair.baseToken.address;
      if (rows.has(mint)) continue;
      // Pump.fun bonding-curve tokens report liquidity.usd = null on
      // DexScreener. Estimate from FDV so the tick() liquidity gate
      // doesn't reject them (see estimateLiquiditySol for the formula).
      const liquidityUsd = pair.liquidity?.usd ?? null;
      const effectiveLiquidityUsd =
        liquidityUsd != null ? liquidityUsd : (pair.fdv ?? pair.marketCap ?? null);
      rows.set(mint, {
        mint,
        lp_mint: null,
        decimals: 6,
        venue: mapDexVenue(pair.dexId),
        symbol: `${pair.baseToken?.symbol ?? "?"}/${pair.quoteToken?.symbol ?? "?"}`,
        discovered_at: pair.pairCreatedAt
          ? new Date(pair.pairCreatedAt).toISOString()
          : new Date().toISOString(),
        safety_score: null,
        // Store the effective liquidity (real or FDV-estimated) so tick()'s
        // `(c.liquidity_usd ?? 0) / 150` produces a non-zero value for
        // bonding-curve tokens.
        liquidity_usd: effectiveLiquidityUsd,
      });
      if (rows.size >= 50) break;
    }
    if (rows.size >= 50) break;
  }

  return [...rows.values()];
}

/**
 * Evaluates on-chain safety for DexScreener fallback candidates so they
 * carry a real safety_score instead of null. Without this, every fallback
 * candidate shows safety=-1 ("not yet scored") in the opportunity feed and
 * is auto-SKIPped — the feed looks alive but the bot never acts.
 *
 * Caps evaluations per request to avoid latency spikes (each check does
 * RPC + Jupiter quote round-trips). Candidates that fail evaluation keep
 * safety_score=null, which tick() maps to -1 (treated as unsafe).
 */
async function scoreFallbackCandidates(candidates: DiscoveryRow[]): Promise<DiscoveryRow[]> {
  const toEvaluate = candidates.slice(0, MAX_EVALUATIONS_PER_REQUEST);
  const scored = await Promise.allSettled(
    toEvaluate.map(async (row) => {
      const result = await evaluateMintSafety(row.mint, row.lp_mint);
      return { ...row, safety_score: result.score };
    }),
  );
  const scoreMap = new Map<string, number>();
  scored.forEach((r, i) => {
    if (r.status === "fulfilled") scoreMap.set(toEvaluate[i].mint, r.value.safety_score);
  });
  return candidates.map((c) =>
    scoreMap.has(c.mint) ? { ...c, safety_score: scoreMap.get(c.mint)! } : c,
  );
}

function structuredDiscoveryError(
  stage: DiscoveryDiagnostics["stage"],
  error: unknown,
  url?: string,
): DiscoveryDiagnostics {
  const message = error instanceof Error ? error.message : String(error);
  const body =
    typeof error === "object" && error && "body" in error
      ? String((error as { body?: unknown }).body ?? "")
      : undefined;
  return {
    stage,
    reason: message,
    url,
    body: body?.slice(0, 500),
    stack: error instanceof Error ? error.stack : undefined,
  };
}

export const Route = createFileRoute("/api/discovery")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async () => {
        let admin: AdminClient;
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          admin = supabaseAdmin as unknown as AdminClient;
        } catch (error) {
          console.error(
            "[discovery] supabase client init failed",
            structuredDiscoveryError("supabase", error),
          );
          const candidates = await fetchDexScreenerFallbackCandidates();
          const scored = await scoreFallbackCandidates(candidates);
          return new Response(
            JSON.stringify({
              candidates: scored,
              source: "dexscreener-fallback",
              diagnostics: [structuredDiscoveryError("supabase", error)],
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json", ...CORS },
            },
          );
        }

        try {
          const { error: pruneError } = await admin
            .from("discovery_candidates")
            .delete()
            .is("safety_score", null)
            .lt("discovered_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
          if (pruneError) {
            console.error("[discovery] prune failed", pruneError);
          }

          const { data: unscored, error: unscoredError } = await admin
            .from("discovery_candidates")
            .select("mint, lp_mint")
            .is("safety_score", null)
            .order("discovered_at", { ascending: true })
            .limit(MAX_EVALUATIONS_PER_REQUEST);

          if (unscoredError) {
            throw Object.assign(new Error(`discovery read failed: ${unscoredError.message}`), {
              stage: "supabase",
              details: unscoredError,
            });
          }

          for (const row of unscored ?? []) {
            try {
              const result = await evaluateMintSafety(row.mint, row.lp_mint);
              const { error: updateError } = await admin
                .from("discovery_candidates")
                .update({
                  safety_score: result.score,
                  raw_payload: JSON.parse(JSON.stringify(result)) as Json,
                })
                .eq("mint", row.mint);
              if (updateError) {
                console.error("[discovery] failed to persist safety score", row.mint, updateError);
              }
            } catch (e) {
              console.error("[discovery] safety evaluation failed", row.mint, e);
            }
          }

          const { data, error } = await admin
            .from("discovery_candidates")
            .select("mint, decimals, venue, symbol, discovered_at, safety_score, liquidity_usd")
            .order("discovered_at", { ascending: false })
            .limit(50);

          if (error) {
            throw Object.assign(new Error(`discovery select failed: ${error.message}`), {
              stage: "supabase",
              details: error,
            });
          }

          // Table reachable but empty (no webhook traffic yet) — top up from
          // DexScreener so discovery is never reported as offline/empty.
          if (!data || data.length === 0) {
            const candidates = await fetchDexScreenerFallbackCandidates();
            const scored = await scoreFallbackCandidates(candidates);
            return new Response(
              JSON.stringify({
                candidates: scored,
                source: "dexscreener-fallback",
                diagnostics: [
                  {
                    stage: "supabase",
                    reason: "discovery_candidates reachable but empty; used DexScreener live pairs",
                  },
                ],
              }),
              { status: 200, headers: { "Content-Type": "application/json", ...CORS } },
            );
          }

          return new Response(
            JSON.stringify({
              candidates: data,
              source: "supabase",
              diagnostics: [],
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json", ...CORS },
            },
          );
        } catch (error) {
          const diagnostics = structuredDiscoveryError("supabase", error);
          console.error(
            "[discovery] supabase unavailable; falling back to DexScreener",
            diagnostics,
          );
          const candidates = await fetchDexScreenerFallbackCandidates();
          const scored = await scoreFallbackCandidates(candidates);
          return new Response(
            JSON.stringify({
              candidates: scored,
              source: "dexscreener-fallback",
              diagnostics: [diagnostics],
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json", ...CORS },
            },
          );
        }
      },
    },
  },
});
