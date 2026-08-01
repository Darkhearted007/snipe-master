import { useEffect, useRef } from "react";
import { useBotStore } from "@/lib/bot-store";
import { logStructured } from "@/lib/structured-logger";
import { computeBackoff } from "@/lib/retry-backoff";
import { estimateLiquiditySol, isBondingCurveTradeable } from "@/lib/liquidity-estimate";

/**
 * DexScreener live feed.
 *
 * We previously connected to `wss://io.dexscreener.com/...` directly, but that
 * socket is DexScreener's internal transport — it rejects cross-origin browser
 * connections and closes immediately, causing an endless reconnect loop.
 *
 * The supported public surface is the REST API at `api.dexscreener.com`, which
 * is CORS-open. We poll a small set of Solana-focused endpoints on an interval
 * and push new pairs into the opportunity feed. Polling is resilient: failures
 * back off with jitter, `online` / `visibilitychange` events force a refresh.
 */
const POLL_INTERVAL_MS = 15_000;
const REQUEST_TIMEOUT_MS = 10_000;

// Trending-ish Solana queries. DexScreener's public search endpoint accepts
// arbitrary terms; these surface active SOL pairs across major venues.
const QUERIES = ["SOL", "raydium", "pumpfun"] as const;

type SearchResponse = {
  pairs?: Array<{
    chainId?: string;
    dexId?: string;
    baseToken?: { symbol?: string; address?: string };
    quoteToken?: { symbol?: string };
    liquidity?: { usd?: number };
    fdv?: number;
    marketCap?: number;
    priceUsd?: string;
    pairCreatedAt?: number;
  }>;
};

/** Maps a DexScreener dexId to our internal venue taxonomy.
 *
 *  CRITICAL: "pumpfun" (bonding-curve) and "pumpswap" (graduated AMM) are
 *  different venues. Bonding-curve tokens must use the pump.fun buy program
 *  (Jupiter can't route them), while graduated tokens trade on pump.fun's AMM
 *  and CAN be routed through Jupiter. Conflating them caused the auto-executor
 *  to route AMM tokens through the bonding-curve path (which fails) or vice
 *  versa.
 *
 *  - "pumpfun"  → "pumpfun"  (bonding curve, use /api/pumpfun/buy)
 *  - "pumpswap" → "raydium"  (graduated AMM, use Jupiter)
 *  - other      → "raydium"
 */
function mapVenue(dexId?: string): "raydium" | "pumpfun" | "bsc" {
  const d = (dexId ?? "").toLowerCase();
  // Only the "pumpfun" dexId is the bonding curve. "pumpswap" is the
  // graduated AMM — route it through Jupiter like any other AMM.
  if (d === "pumpfun") return "pumpfun";
  if (d.includes("pancake") || d.includes("bsc")) return "bsc";
  return "raydium";
}

async function fetchPairs(query: string, signal: AbortSignal): Promise<SearchResponse> {
  const res = await fetch(
    `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`,
    { signal, headers: { accept: "application/json" } },
  );
  if (!res.ok) throw new Error(`dexscreener ${res.status}`);
  return (await res.json()) as SearchResponse;
}

type SafetyVerdictResponse =
  | {
      ok: true;
      score: number | null;
      verdict: "safe" | "caution" | "danger" | "unknown";
      flags?: {
        lpLocked: boolean | null;
        lpLockedPct: number | null;
        topHolderPct: number | null;
        insiderPct: number | null;
      };
      onChain?: {
        score: number;
        mintAuthorityActive: boolean | null;
        freezeAuthorityActive: boolean | null;
        honeypotSellable: boolean | null;
        lpStatus: string;
        reasons: string[];
      } | null;
    }
  | { ok: false; error: string };

/** Calls the existing /api/rugcheck/$mint route, which merges rugcheck.xyz's
 *  report with a real on-chain check (mint/freeze authority, LP lock/burn,
 *  honeypot probe) into one verdict. Returns the full flags + on-chain data
 *  so applySafetyVerdict can check requireLpLocked, blockHoneypots, and
 *  maxHolderConcentrationPct against the user's SafetyFilters config. */
async function fetchSafetyVerdict(
  mint: string,
  signal: AbortSignal,
): Promise<{
  score: number | null;
  verdict: "safe" | "caution" | "danger" | "unknown";
  flags?: {
    lpLocked: boolean | null;
    topHolderPct: number | null;
    honeypotSellable: boolean | null;
  };
}> {
  const res = await fetch(`/api/rugcheck/${encodeURIComponent(mint)}`, { signal });
  if (!res.ok) throw new Error(`safety check ${res.status}`);
  const data = (await res.json()) as SafetyVerdictResponse;
  if (!data.ok) throw new Error(data.error);
  return {
    score: data.score,
    verdict: data.verdict,
    flags: {
      lpLocked: data.flags?.lpLocked ?? null,
      topHolderPct: data.flags?.topHolderPct ?? null,
      honeypotSellable: data.onChain?.honeypotSellable ?? null,
    },
  };
}

export function useDexScreenerStream(enabled: boolean) {
  const logAudit = useBotStore((s) => s.logAudit);
  const pushRealOpportunity = useBotStore((s) => s.pushRealOpportunity);
  const applySafetyVerdict = useBotStore((s) => s.applySafetyVerdict);
  const timer = useRef<number | null>(null);
  const attempt = useRef(0);
  const announced = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const abort = new AbortController();

    const clearTimer = () => {
      if (timer.current != null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
    };

    const tick = async () => {
      if (cancelled) return;
      const to = window.setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
      try {
        const results = await Promise.allSettled(QUERIES.map((q) => fetchPairs(q, abort.signal)));
        window.clearTimeout(to);
        let pushed = 0;
        for (const r of results) {
          if (r.status !== "fulfilled") continue;
          const pairs = (r.value.pairs ?? []).filter(
            (p) => p.chainId === "solana" && p.baseToken?.address,
          );
          for (const p of pairs.slice(0, 4)) {
            const symbol = `${p.baseToken?.symbol ?? "?"}/${p.quoteToken?.symbol ?? "?"}`;
            // pump.fun bonding-curve tokens report liquidity.usd = null
            // (no LP pool — the curve IS the liquidity). Estimate from
            // FDV/marketCap so they aren't rejected by the liquidity gate.
            const venue = mapVenue(p.dexId);
            const liquiditySol = estimateLiquiditySol({
              liquidityUsd: p.liquidity?.usd,
              fdv: p.fdv,
              marketCap: p.marketCap,
            });
            // Skip tokens with no discoverable liquidity at all (dust/scam).
            if (
              !isBondingCurveTradeable({
                liquidityUsd: p.liquidity?.usd,
                fdv: p.fdv,
                marketCap: p.marketCap,
              })
            ) {
              continue;
            }
            const mint = p.baseToken?.address;
            const priceUsd = p.priceUsd ? parseFloat(p.priceUsd) : null;
            const oppId = pushRealOpportunity({
              token: p.baseToken?.symbol ?? "UNKNOWN",
              venue,
              symbol,
              liquiditySol,
              tokenAddress: mint,
              priceUsd,
            });
            if (oppId && mint) {
              // Fire-and-forget: the opportunity starts as safety=-1/"skip"
              // and only flips to a real decision once this resolves. Never
              // await this inline — a slow safety check must not stall
              // discovery of the next pair.
              fetchSafetyVerdict(mint, abort.signal)
                .then((v) => {
                  applySafetyVerdict({
                    opportunityId: oppId,
                    score: v.score,
                    verdict: v.verdict,
                    flags: v.flags,
                  });
                })
                .catch((e) => {
                  logStructured(e, {
                    category: "stream",
                    severity: "info",
                    silent: true,
                    userMessage: `Safety check failed for ${symbol}`,
                    context: { mint },
                  });
                });
            }
            pushed++;
          }
        }
        attempt.current = 0;
        if (!announced.current && pushed > 0) {
          announced.current = true;
          logAudit("DexScreener live feed connected (REST poll)", "audit");
        }
        if (!cancelled) {
          timer.current = window.setTimeout(tick, POLL_INTERVAL_MS) as unknown as number;
        }
      } catch (e) {
        window.clearTimeout(to);
        if (cancelled) return;
        const n = (attempt.current += 1);
        const backoff = computeBackoff(n, { baseMs: 2_000, maxMs: 60_000 });
        logStructured(e, {
          category: "stream",
          severity: n >= 3 ? "warning" : "info",
          silent: n < 3,
          userMessage: `Live market feed error — retrying in ${Math.round(backoff / 1000)}s`,
          context: { attempt: n, backoffMs: backoff },
        });
        timer.current = window.setTimeout(tick, backoff) as unknown as number;
      }
    };

    const forceRefresh = () => {
      clearTimer();
      void tick();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") forceRefresh();
    };

    void tick();
    window.addEventListener("online", forceRefresh);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      clearTimer();
      abort.abort();
      window.removeEventListener("online", forceRefresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, logAudit, pushRealOpportunity, applySafetyVerdict]);
}
