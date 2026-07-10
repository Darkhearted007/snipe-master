export type BotMode = "paper" | "live";
export type BotStatus = "idle" | "running" | "paused" | "error";
export type Venue = "raydium" | "pumpfun" | "bsc";
export type DecisionType =
  "feed" | "safety" | "strategy" | "execution" | "learning" | "audit" | "wallet" | "error";

export interface Opportunity {
  id: string;
  ts: number;
  token: string;
  mint?: string; // real SPL mint address for live-discovered tokens; absent for paper-mode synthetic tokens
  venue: Venue;
  liquiditySol: number;
  safety: number; // -1 = not yet checked; never treat as a passing score
  confidence: number;
  decision: "enter" | "skip";
  reason?: string;
}

export interface Position {
  id: string;
  token: string;
  mint?: string;
  venue: Venue;
  entry: number;
  current: number;
  sizeSol: number;
  tp: number;
  sl: number;
  openedAt: number;
  agentSized?: boolean;
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
  /** Optional Solana SPL mint address — enables per-row rugcheck.xyz lookups. */
  mintAddress?: string | null;
}

export interface SafetyFilters {
  minSafety: number;
  minLiquiditySol: number;
  requireLpLocked: boolean;
  blockHoneypots: boolean;
  maxHolderConcentrationPct: number;
}

export type SettlementStatus = "n/a" | "pending" | "settled" | "failed";

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
  // Profit audit trail — populated as on-chain settlement progresses.
  settlementStatus: SettlementStatus;
  feeTxSig?: string;
  settlementError?: string;
  settledAt?: number;
}

export const PLATFORM_FEE_WALLET = "CQf2TBVCtKAjJw1mEGpEYPVn7MUgGJ87wP4esHJhftsF";
export const MIN_USER_DEPOSIT_SOL = 0.1;
