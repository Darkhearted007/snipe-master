import { useEffect, useRef } from "react";
import { useBotStore } from "@/lib/bot-store";

// DexScreener WSS streams. Browsers connect directly — no CORS on WSS,
// no auth needed. Each feed is a separate socket; we reconnect with
// exponential backoff and forward safety-passing events into the bot store.
const FEEDS = [
  "wss://io.dexscreener.com/dex/screener/pairs/h24/1?rankBy[key]=trendingScoreH6&rankBy[order]=desc",
  "wss://io.dexscreener.com/dex/screener/pairs/m5/1?rankBy[key]=pairAge&rankBy[order]=asc",
] as const;

type PairMsg = {
  pairs?: Array<{
    chainId?: string;
    baseToken?: { symbol?: string; address?: string };
    quoteToken?: { symbol?: string };
    liquidity?: { usd?: number };
    priceUsd?: string;
    dexId?: string;
  }>;
};

function mapVenue(dexId?: string): "raydium" | "pumpfun" | "bsc" {
  const d = (dexId ?? "").toLowerCase();
  if (d.includes("pump")) return "pumpfun";
  if (d.includes("pancake") || d.includes("bsc")) return "bsc";
  return "raydium";
}

/** Streams real DexScreener pair updates into the bot's opportunity feed.
 *  No-op unless the bot is running in live mode. Never blocks the loop. */
export function useDexScreenerStream(enabled: boolean) {
  const logAudit = useBotStore((s) => s.logAudit);
  const pushRealOpportunity = useBotStore((s) => s.pushRealOpportunity);
  const sockets = useRef<WebSocket[]>([]);
  const retries = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const open = (url: string) => {
      if (cancelled) return;
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (e) {
        logAudit(`DexScreener WSS open failed: ${(e as Error).message}`, "error");
        return;
      }
      sockets.current.push(ws);

      ws.onopen = () => {
        retries.current[url] = 0;
        logAudit(`DexScreener stream connected`, "audit");
      };
      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(String(ev.data)) as PairMsg;
          if (!data.pairs?.length) return;
          for (const p of data.pairs.slice(0, 5)) {
            const symbol = `${p.baseToken?.symbol ?? "?"}/${p.quoteToken?.symbol ?? "?"}`;
            const liquidityUsd = p.liquidity?.usd ?? 0;
            // rough USD → SOL @ $150 (only used for filter comparison).
            const liquiditySol = liquidityUsd / 150;
            pushRealOpportunity({
              token: p.baseToken?.symbol ?? "UNKNOWN",
              venue: mapVenue(p.dexId),
              symbol,
              liquiditySol,
              tokenAddress: p.baseToken?.address,
            });
          }
        } catch {
          /* ignore malformed */
        }
      };
      ws.onclose = () => {
        if (cancelled) return;
        const attempt = (retries.current[url] ?? 0) + 1;
        retries.current[url] = attempt;
        const backoff = Math.min(30_000, 1_000 * 2 ** Math.min(attempt, 5));
        setTimeout(() => open(url), backoff);
      };
      ws.onerror = () => {
        // swallow — onclose handles reconnect
      };
    };

    const onOnline = () => {
      // force-reconnect any closed sockets
      for (const url of FEEDS) open(url);
    };
    for (const url of FEEDS) open(url);
    window.addEventListener("online", onOnline);

    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
      for (const ws of sockets.current) {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }
      sockets.current = [];
    };
  }, [enabled, logAudit, pushRealOpportunity]);
}
