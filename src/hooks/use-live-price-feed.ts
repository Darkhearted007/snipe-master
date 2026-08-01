// Live price feed for open positions.
//
// pump.fun bonding-curve tokens (and any AMM token) don't have a reliable
// on-chain price oracle we can read cheaply from the browser. DexScreener's
// REST API (`/latest/dex/tokens/{mint}`) is CORS-open and returns the current
// `priceUsd` for every pair involving the mint \u2014 we poll it on an interval
// and feed the results into `updateLivePositionPrice()` so the store's equity
// curve, TP/SL checks, and P&L display stay accurate in real time.
//
// Without this hook, live positions' `current` price is frozen at `entry`
// forever (tick() skips live positions, and nothing else calls
// updateLivePositionPrice). That means TP/SL exits never fire and the P&L
// shown in the UI is always zero \u2014 the bot can't auto-exit.
//
// Design:
//   \u2022 Only polls when there are live positions (no wasted requests when the
//     book is empty or in paper mode).
//   \u2022 Batches all open-position mints into one poll per interval (DexScreener
//     accepts comma-separated token addresses in a single request).
//   \u2022 Tracks the first-observed USD price per mint as the "entry reference"
//     so the pnl ratio (current/entry) accurately reflects price movement
//     since the position was first seen by the feed.
//   \u2022 Catches and logs all errors \u2014 a failed poll is non-fatal; the next
//     interval retries.

import { useEffect, useRef } from "react";
import { useBotStore } from "@/lib/bot-store";
import type { Position } from "@/lib/bot-types";

const POLL_INTERVAL_MS = 10_000; // 10s \u2014 fast enough for TP/SL, gentle on the API
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_MINTS_PER_REQUEST = 50; // DexScreener limit

type DexScreenerTokenResponse = {
  pairs?: Array<{
    chainId?: string;
    dexId?: string;
    baseToken?: { address?: string; symbol?: string };
    priceUsd?: string;
    liquidity?: { usd?: number | null };
    fdv?: number;
  }>;
};

/**
 * Fetch current USD prices for a batch of token mints from DexScreener.
 * Returns a map of mint \u2192 priceUsd. Picks the pair with the highest
 * liquidity for each mint (most reliable price).
 */
async function fetchTokenPrices(
  mints: string[],
  signal: AbortSignal,
): Promise<Map<string, number>> {
  if (mints.length === 0) return new Map();
  const url = `https://api.dexscreener.com/latest/dex/tokens/${mints.join(",")}`;
  const res = await fetch(url, {
    signal,
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`dexscreener tokens ${res.status}`);
  const data = (await res.json()) as DexScreenerTokenResponse;
  const pairs = data.pairs ?? [];

  // Group pairs by base token address, keeping the one with highest liquidity
  const bestByMint = new Map<string, { priceUsd: number; liquidity: number }>();
  for (const pair of pairs) {
    // Only Solana pairs
    if (pair.chainId !== "solana") continue;
    const addr = pair.baseToken?.address;
    if (!addr) continue;
    const priceUsd = parseFloat(pair.priceUsd ?? "0");
    if (!Number.isFinite(priceUsd) || priceUsd <= 0) continue;
    const liq = pair.liquidity?.usd ?? pair.fdv ?? 0;
    const existing = bestByMint.get(addr);
    if (!existing || liq > existing.liquidity) {
      bestByMint.set(addr, { priceUsd, liquidity: liq });
    }
  }

  const result = new Map<string, number>();
  for (const [mint, info] of bestByMint) {
    result.set(mint, info.priceUsd);
  }
  return result;
}

/** Resolve the mint address from a position (handles both `mint` and legacy `mintAddress`). */
function positionMint(p: Position): string | null {
  return p.mint ?? (p as Position & { mintAddress?: string | null }).mintAddress ?? null;
}

/**
 * Polls DexScreener for the current USD price of every open live position's
 * token, then updates the store via `updateLivePositionPrice()`.
 *
 * The price is converted to a SOL-relative ratio so the existing pnl math
 * (pnl = (current - entry) * sizeSol / entry) continues to work. We track
 * the first-observed USD price per mint as the entry reference, then compute
 * current = entry * (priceNow / priceAtEntry). This ensures the pnl ratio
 * always reflects real price movement since the feed first saw the position.
 *
 * `enabled` should be true only in live mode.
 */
export function useLivePriceFeed(enabled: boolean) {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // mint \u2192 entry USD price (first observed). Persists across re-renders.
  const entryPriceUsdRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (!enabled) {
      if (timer.current) {
        clearInterval(timer.current);
        timer.current = null;
      }
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
      return;
    }

    const poll = async () => {
      const state = useBotStore.getState();
      // Only poll for live positions (paper-mode positions are random-walked
      // by tick()). Skip if no live positions exist.
      const livePositions = state.positions.filter((p) => p.live && positionMint(p));
      if (livePositions.length === 0) return;

      // Collect unique mints (cap at MAX_MINTS_PER_REQUEST)
      const mintSet = new Set<string>();
      for (const p of livePositions) {
        const mint = positionMint(p);
        if (mint) mintSet.add(mint);
      }
      const mints = Array.from(mintSet).slice(0, MAX_MINTS_PER_REQUEST);

      const controller = new AbortController();
      abortRef.current = controller;
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        const prices = await fetchTokenPrices(mints, controller.signal);
        const updateLivePositionPrice = useBotStore.getState().updateLivePositionPrice;

        for (const p of livePositions) {
          const mint = positionMint(p);
          if (!mint) continue;
          const priceUsd = prices.get(mint);
          if (!priceUsd || !Number.isFinite(priceUsd) || priceUsd <= 0) continue;

          const entryUsd = entryPriceUsdRef.current.get(mint);
          if (entryUsd == null) {
            // First time we see this mint's price \u2014 record it as the entry
            // reference. No price change yet, so current stays at entry.
            entryPriceUsdRef.current.set(mint, priceUsd);
          } else if (entryUsd > 0) {
            const ratio = priceUsd / entryUsd;
            const newCurrent = p.entry * ratio;
            if (Number.isFinite(newCurrent) && newCurrent > 0 && newCurrent !== p.current) {
              updateLivePositionPrice(mint, newCurrent);
            }
          }
        }
      } catch (e) {
        // Non-fatal \u2014 the next interval retries. Only log if it's not an
        // abort (aborts happen on unmount / re-render).
        if (!(e instanceof DOMException && e.name === "AbortError")) {
          const logAudit = useBotStore.getState().logAudit;
          logAudit(
            `PriceFeed \u00b7 poll failed: ${e instanceof Error ? e.message : String(e)}`,
            "audit",
          );
        }
      } finally {
        clearTimeout(timeoutId);
      }
    };

    // Poll immediately, then on interval
    poll();
    timer.current = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      if (timer.current) {
        clearInterval(timer.current);
        timer.current = null;
      }
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    };
  }, [enabled]);
}
