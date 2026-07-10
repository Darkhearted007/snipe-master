import { useEffect, useRef } from "react";
import { useBotStore } from "@/lib/bot-store";
import { logStructured } from "@/lib/structured-logger";
import { computeBackoff } from "@/lib/retry-backoff";

// DexScreener WSS streams. Browsers connect directly — no CORS on WSS,
// no auth needed. Each feed is a separate socket; we reconnect with
// full-jitter exponential backoff and use a heartbeat watchdog to force
// reconnect when the server goes silent (common on flaky mobile links).
const FEEDS = [
  "wss://io.dexscreener.com/dex/screener/pairs/h24/1?rankBy[key]=trendingScoreH6&rankBy[order]=desc",
  "wss://io.dexscreener.com/dex/screener/pairs/m5/1?rankBy[key]=pairAge&rankBy[order]=asc",
] as const;

const HEARTBEAT_TIMEOUT_MS = 45_000; // no message for 45s → reconnect

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
  const sockets = useRef<Map<string, WebSocket>>(new Map());
  const retries = useRef<Record<string, number>>({});
  const reconnectTimers = useRef<Map<string, number>>(new Map());
  const heartbeatTimers = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const clearHeartbeat = (url: string) => {
      const t = heartbeatTimers.current.get(url);
      if (t) window.clearTimeout(t);
    };
    const armHeartbeat = (url: string, ws: WebSocket) => {
      clearHeartbeat(url);
      const t = window.setTimeout(() => {
        // Server went silent — treat as dead and let onclose reconnect.
        logStructured(new Error("stream heartbeat timeout"), {
          category: "stream",
          severity: "warning",
          silent: true,
          context: { url, timeoutMs: HEARTBEAT_TIMEOUT_MS },
        });
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }, HEARTBEAT_TIMEOUT_MS);
      heartbeatTimers.current.set(url, t as unknown as number);
    };

    const scheduleReconnect = (url: string) => {
      if (cancelled) return;
      const attempt = (retries.current[url] ?? 0) + 1;
      retries.current[url] = attempt;
      const backoff = computeBackoff(attempt, { baseMs: 1_000, maxMs: 30_000 });
      logStructured(new Error(`stream closed (attempt ${attempt})`), {
        category: "stream",
        severity: attempt >= 3 ? "warning" : "info",
        silent: attempt < 3,
        userMessage: `Live market stream disconnected — retrying in ${Math.round(backoff / 1000)}s`,
        context: { url, attempt, backoffMs: backoff },
      });
      const timer = window.setTimeout(() => open(url), backoff);
      reconnectTimers.current.set(url, timer as unknown as number);
    };

    const open = (url: string) => {
      if (cancelled) return;
      // Drop any previous socket for this url before opening a new one.
      const prev = sockets.current.get(url);
      if (prev && prev.readyState <= 1) {
        try {
          prev.close();
        } catch {
          /* ignore */
        }
      }
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (e) {
        logStructured(e, { category: "stream", context: { url, phase: "open" } });
        scheduleReconnect(url);
        return;
      }
      sockets.current.set(url, ws);

      ws.onopen = () => {
        retries.current[url] = 0;
        logAudit(`DexScreener stream connected`, "audit");
        armHeartbeat(url, ws);
      };
      ws.onmessage = (ev) => {
        armHeartbeat(url, ws);
        try {
          const data = JSON.parse(String(ev.data)) as PairMsg;
          if (!data.pairs?.length) return;
          for (const p of data.pairs.slice(0, 5)) {
            const symbol = `${p.baseToken?.symbol ?? "?"}/${p.quoteToken?.symbol ?? "?"}`;
            const liquidityUsd = p.liquidity?.usd ?? 0;
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
        clearHeartbeat(url);
        sockets.current.delete(url);
        scheduleReconnect(url);
      };
      ws.onerror = () => {
        // onclose fires next and handles reconnect + logging.
      };
    };

    const onOnline = () => {
      // Network came back — reset backoff and force-reconnect everything.
      for (const url of FEEDS) {
        retries.current[url] = 0;
        const t = reconnectTimers.current.get(url);
        if (t) window.clearTimeout(t);
        open(url);
      }
    };
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      // Tab came back — verify sockets are alive, otherwise reconnect.
      for (const url of FEEDS) {
        const ws = sockets.current.get(url);
        if (!ws || ws.readyState > 1) {
          const t = reconnectTimers.current.get(url);
          if (t) window.clearTimeout(t);
          open(url);
        }
      }
    };

    for (const url of FEEDS) open(url);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibility);
      for (const t of reconnectTimers.current.values()) window.clearTimeout(t);
      for (const t of heartbeatTimers.current.values()) window.clearTimeout(t);
      reconnectTimers.current.clear();
      heartbeatTimers.current.clear();
      for (const ws of sockets.current.values()) {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }
      sockets.current.clear();
    };
  }, [enabled, logAudit, pushRealOpportunity]);
}

