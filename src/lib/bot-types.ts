export type BotMode = "paper" | "live";
export type BotStatus = "idle" | "running" | "paused" | "error";
export type Venue = "raydium" | "pumpfun" | "bsc";
export type DecisionType = "feed" | "safety" | "strategy" | "execution" | "learning";

export interface Opportunity {
  id: string;
  ts: number;
  token: string;
  venue: Venue;
  liquiditySol: number;
  safety: number; // 0-100
  confidence: number; // 0-100
  decision: "enter" | "skip";
  reason?: string;
}

export interface Position {
  id: string;
  token: string;
  venue: Venue;
  entry: number;
  current: number;
  sizeSol: number;
  tp: number;
  sl: number;
  openedAt: number;
}

export interface DecisionLogEntry {
  id: string;
  ts: number;
  type: DecisionType;
  summary: string;
}

export interface Guardrails {
  maxPositionSol: number;
  dailyLossLimitPct: number;
  drawdownLimitPct: number;
  duplicateGuard: boolean;
}

export interface EquityPoint {
  ts: number;
  value: number;
}

export type WatchSource = "manual" | "auto";

export interface WatchEntry {
  id: string;
  symbol: string; // TOKEN/QUOTE
  venue: Venue;
  source: WatchSource;
  enabled: boolean;
  safety: number; // 0-100
  liquiditySol: number;
  positiveStreak: number; // consecutive positive decisions
  addedAt: number;
  note?: string;
}

export interface SafetyFilters {
  minSafety: number; // 0-100
  minLiquiditySol: number;
  requireLpLocked: boolean;
  blockHoneypots: boolean;
  maxHolderConcentrationPct: number;
}
