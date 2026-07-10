export type BotMode = "paper" | "live";
export type BotStatus = "idle" | "running" | "paused" | "error";
export type Venue = "raydium" | "pumpfun" | "bsc";
export type DecisionType =
  "feed" | "safety" | "strategy" | "execution" | "learning" | "audit" | "wallet" | "error";

export interface Opportunity {
  id: string;
  ts: number;
  token: string;
  mint?: string; // real SPL mint address; undefined = synthetic paper-mode token
  decimals?: number;
  venue: Venue;
  liquiditySol: number;
  safety: number;
  confidence: number;
  decision: "enter" | "skip";
  reason?: string;
}

export interface Position {
  id: string;
  token: string;
  mint?: string; // real SPL mint address; undefined = synthetic paper-mode position
  decimals?: number;
  venue: Venue;
  entry: number;
  current: number;
  sizeSol: number;
  tp: number;
  sl: number;
  openedAt: number;
  agentSized?: boolean;
  live?: boolean; // true once a real entry swap has been confirmed on-chain
  entrySignature?: string;
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
  adaptiveSizing: boolean; // agent decides size, ignores maxPositionSol cap
}

export interface EquityPoint {
  ts: number;
  value: number;
}

export type WatchSource = "manual" | "auto";

export interface WatchEntry {
  id: string;
  symbol: string;
  venue: Venue;
  source: WatchSource;
  enabled: boolean;
  safety: number;
  liquiditySol: number;
  positiveStreak: number;
  addedAt: number;
  note?: string;
}

export interface SafetyFilters {
  minSafety: number;
  minLiquiditySol: number;
  requireLpLocked: boolean;
  blockHoneypots: boolean;
  maxHolderConcentrationPct: number;
}

export interface TradeHistoryEntry {
  id: string;
  ts: number;
  mode: BotMode;
  token: string;
  venue: Venue;
  sizeSol: number;
  entry: number;
  exit: number;
  pnlSol: number;
  reason: "tp" | "sl" | "manual" | "kill";
  feePaidSol: number; // platform fee routed on profit
  netToUserSol: number; // pnl after fee (only live)
  feeWallet?: string;
}

export interface DiscoveryCandidate {
  mint: string;
  decimals: number;
  venue: string; // e.g. "solana/raydium" — mapped to Venue at the call site
  symbol: string;
  discovered_at: string;
  safety_score: number | null;
  liquidity_usd: number | null;
}

export const PLATFORM_FEE_WALLET = "CQf2TBVCtKAjJw1mEGpEYPVn7MUgGJ87wP4esHJhftsF";
export const MIN_USER_DEPOSIT_SOL = 0.1;
