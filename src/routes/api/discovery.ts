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
  order(column: string, opts: { ascending: boolean }): this;
  limit(n: number): Promise<{ data: DiscoveryRow[] | null; error: { message: string } | null }>;
  update(values: Partial<DiscoveryRow>): {
    eq(column: string, value: unknown): Promise<{ error: { message: string } | null }>;
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

// Cap how many unscored mints we evaluate per request — each one is several
// sequential/parallel RPC + Jupiter round-trips, and this runs inside a
// serverless function with a hard wall-clock limit. Better to score a few
// per poll (every ~8s from the client) than time out trying to do them all.
const MAX_EVALUATIONS_PER_REQUEST = 3;

export const Route = createFileRoute("/api/discovery")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const admin = supabaseAdmin as unknown as AdminClient;

        // Best-effort prune; don't fail the read if it errors.
        const pruneResult = await admin.rpc("prune_stale_discovery_candidates");
        if (pruneResult.error) {
          console.error("[discovery] prune failed", pruneResult.error);
        }

        const { data: unscored } = await admin
          .from("discovery_candidates")
          .select("mint, lp_mint")
          .is("safety_score", null)
          .order("discovered_at", { ascending: true })
          .limit(MAX_EVALUATIONS_PER_REQUEST);

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
            // One bad mint (RPC hiccup, no route, etc.) must never block the
            // read below or poison the rest of the batch.
            console.error("[discovery] safety evaluation failed", row.mint, e);
          }
        }

        const { data, error } = await admin
          .from("discovery_candidates")
          .select("mint, decimals, venue, symbol, discovered_at, safety_score, liquidity_usd")
          .order("discovered_at", { ascending: false })
          .limit(50);

        if (error) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...CORS },
          });
        }

        return new Response(JSON.stringify({ candidates: data ?? [] }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...CORS },
        });
      },
    },
  },
});
