import { createFileRoute } from "@tanstack/react-router";
import { extractCandidatesFromWebhookTx } from "@/lib/pool-discovery";
import { evaluateMintSafety } from "@/lib/onchain-safety";
import type { Json } from "@/integrations/supabase/types";

interface DiscoveryRow {
  mint: string;
  lp_mint: string | null;
  decimals: number;
  venue: string;
  symbol: string;
  discovered_at?: string;
  safety_score?: number | null;
  liquidity_usd?: number | null;
  raw_payload?: Json;
  discovery_signature?: string;
}

interface DiscoveryUpsertBuilder {
  upsert(
    rows: Partial<DiscoveryRow>[],
    opts?: { onConflict?: string; ignoreDuplicates?: boolean },
  ): Promise<{ error: { message: string } | null }>;
}

interface AdminClient {
  from(table: "discovery_candidates"): DiscoveryUpsertBuilder;
}

// Helius "raw" webhook — POST one array of getTransaction-shaped objects
// per matching signature. Configure the webhook (via Helius dashboard or
// their /v0/webhooks API) with:
//   webhookType: "raw"
//   transactionTypes: ["UNKNOWN"]  (raw mode doesn't classify)
//   accountAddresses: [RAYDIUM_AMM_V4, RAYDIUM_CPMM, PUMP_FUN program IDs]
//   authHeader: <same value as HELIUS_WEBHOOK_SECRET below>
//
// This endpoint is unauthenticated to the public internet by construction
// (Helius calls it from their servers) — the authHeader check below is the
// only thing stopping someone from POSTing fabricated "new token" candidates
// to manipulate what the bot considers for entry. Do not remove it.

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const Route = createFileRoute("/api/webhooks/helius-pool-discovery")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.HELIUS_WEBHOOK_SECRET;
        if (!secret) {
          console.error("[pool-discovery] HELIUS_WEBHOOK_SECRET not configured");
          return new Response(JSON.stringify({ error: "Webhook not configured" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        const provided = request.headers.get("authorization") ?? "";
        if (!timingSafeEqual(provided, secret)) {
          // Deliberately generic — don't tell an attacker whether the path
          // exists vs. the auth was wrong.
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        let payload: unknown;
        try {
          payload = await request.json();
        } catch {
          return new Response(JSON.stringify({ error: "Invalid JSON" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const txs = Array.isArray(payload) ? payload : [payload];
        const candidates = txs.flatMap((tx) =>
          extractCandidatesFromWebhookTx(
            tx as Parameters<typeof extractCandidatesFromWebhookTx>[0],
          ),
        );

        if (candidates.length === 0) {
          return new Response(JSON.stringify({ inserted: 0 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        // Server-only import — never let this admin client leak into a
        // client bundle.
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Evaluate safety synchronously so safety_score is populated by the
        // time this response returns, rather than staying NULL indefinitely.
        // This adds real latency per candidate (RPC + 2 Jupiter quote calls)
        // — fine for the current volume, but if discovery ever gets busy
        // enough that this blocks the webhook response too long, move this
        // to a queue instead of inlining it here.
        const scored = await Promise.all(
          candidates.map(async (c) => {
            try {
              const safety = await evaluateMintSafety(c.mint, c.lpMint);
              return { ...c, safety };
            } catch (error) {
              console.error(`[pool-discovery] safety eval failed for ${c.mint}`, error);
              return { ...c, safety: null };
            }
          }),
        );

        const { error } = await (supabaseAdmin as any).from("discovery_candidates").upsert(
          scored.map((c) => ({
            mint: c.mint,
            decimals: c.decimals,
            venue: c.venue,
            symbol: c.symbol,
            discovery_signature: c.discoverySignature,
            lp_mint: c.lpMint,
            safety_score: c.safety?.score ?? null,
            raw_payload: c.safety ? (JSON.parse(JSON.stringify(c.safety)) as Json) : null,
          })),
          { onConflict: "mint", ignoreDuplicates: true },
        );

        if (error) {
          console.error("[pool-discovery] Supabase upsert failed", error);
          return new Response(JSON.stringify({ error: "Storage failure" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify({ inserted: candidates.length }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
