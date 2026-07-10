import { useEffect, useRef } from "react";
import { useBotStore } from "@/lib/bot-store";
import { logStructured } from "@/lib/structured-logger";
import { computeBackoff } from "@/lib/retry-backoff";

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
    priceUsd?: string;
    pairCreatedAt?: number;
  }>;
};

function mapVenue(dexId?: string): "raydium" | "pumpfun" | "bsc" {
  const d = (dexId ?? "").toLowerCase();
  if (d.includes("pump")) return "pumpfun";
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

export function useDexScreenerStream(enabled: boolean) {
  const logAudit = useBotStore((s) => s.logAudit);
  const pushRealOpportunity = useBotStore((s) => s.pushRealOpportunity);
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
        const results = await Promise.allSettled(
          QUERIES.map((q) => fetchPairs(q, abort.signal)),
        );
        window.clearTimeout(to);
        let pushed = 0;
        for (const r of results) {
          if (r.status !== "fulfilled") continue;
          const pairs = (r.value.pairs ?? []).filter(
            (p) => p.chainId === "solana" && p.baseToken?.address,
          );
          for (const p of pairs.slice(0, 4)) {
            const symbol = `${p.baseToken?.symbol ?? "?"}/${p.quoteToken?.symbol ?? "?"}`;
            const liquidityUsd = p.liquidity?.usd ?? 0;
            pushRealOpportunity({
              token: p.baseToken?.symbol ?? "UNKNOWN",
              venue: mapVenue(p.dexId),
              symbol,
              liquiditySol: liquidityUsd / 150,
              tokenAddress: p.baseToken?.address,
            });
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
  }, [enabled, logAudit, pushRealOpportunity]);
}
