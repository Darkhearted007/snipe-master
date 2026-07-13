/**
 * Agent council: shared memory & bias helpers.
 *
 * Two agents sit on the council:
 *  - Scout   — nudges the strategy layer's confidence based on how prior
 *              trades on the same token have played out. Runs every tick.
 *  - Auditor — every N closed trades, debriefs the council: win rate,
 *              best/worst tokens, cycle P&L. Persisted as memory so
 *              future sessions "remember" what worked.
 *
 * Memory rows live in Supabase (`public.council_memory`) but are also
 * mirrored to a local slice on the bot store so decisions are fast &
 * work offline. Sync is one-way for now: local writes → server best-effort.
 */

import type { TradeHistoryEntry } from "./bot-types";

export type CouncilAgent = "scout" | "auditor" | "council";

export interface CouncilMemoryEntry {
  id: string;
  ts: number;
  cycleId: string;
  agent: CouncilAgent;
  summary: string;
  /** Free-form insights. `perTokenPnl` seeds the Scout's bias table. */
  insights: {
    perTokenPnl?: Record<string, number>;
    winRate?: number;
    bestToken?: string | null;
    worstToken?: string | null;
  };
  pnlDeltaSol: number;
  tradesInWindow: number;
}

export const DEBRIEF_TRADE_WINDOW = 5;
export const MAX_COUNCIL_MEMORY = 60;

/** Aggregate per-token net P&L across council memory, capped to +/-20
 *  so the Scout's nudge can't overwhelm the strategy layer. */
export function scoutBiasForToken(memory: CouncilMemoryEntry[], token: string): number {
  let acc = 0;
  for (const m of memory) {
    const v = m.insights?.perTokenPnl?.[token];
    if (typeof v === "number" && Number.isFinite(v)) acc += v;
  }
  // Scale: 1 SOL of prior net pnl → ~10 conf points, clamped to ±20.
  const scaled = Math.max(-20, Math.min(20, Math.round(acc * 10)));
  return scaled;
}

/** Build the Auditor's debrief record from the most recent N trades. */
export function buildDebrief(input: {
  cycleId: string;
  windowTrades: TradeHistoryEntry[];
}): CouncilMemoryEntry {
  const trades = input.windowTrades;
  const wins = trades.filter((t) => t.pnlSol > 0).length;
  const winRate = trades.length ? wins / trades.length : 0;
  const perTokenPnl: Record<string, number> = {};
  for (const t of trades) {
    perTokenPnl[t.token] = (perTokenPnl[t.token] ?? 0) + t.netToUserSol;
  }
  let bestToken: string | null = null;
  let worstToken: string | null = null;
  let bestVal = -Infinity;
  let worstVal = Infinity;
  for (const [tok, pnl] of Object.entries(perTokenPnl)) {
    if (pnl > bestVal) {
      bestVal = pnl;
      bestToken = tok;
    }
    if (pnl < worstVal) {
      worstVal = pnl;
      worstToken = tok;
    }
  }
  const pnlDelta = trades.reduce((a, t) => a + t.netToUserSol, 0);
  const summary =
    `Council debrief · ${trades.length} trades · win ${(winRate * 100).toFixed(0)}% · ` +
    `net ${pnlDelta >= 0 ? "+" : ""}${pnlDelta.toFixed(5)} SOL` +
    (bestToken ? ` · best ${bestToken} ${bestVal >= 0 ? "+" : ""}${bestVal.toFixed(4)}` : "") +
    (worstToken && worstToken !== bestToken
      ? ` · worst ${worstToken} ${worstVal >= 0 ? "+" : ""}${worstVal.toFixed(4)}`
      : "");
  return {
    id: Math.random().toString(36).slice(2, 10),
    ts: Date.now(),
    cycleId: input.cycleId,
    agent: "auditor",
    summary,
    insights: { perTokenPnl, winRate, bestToken, worstToken },
    pnlDeltaSol: pnlDelta,
    tradesInWindow: trades.length,
  };
}
