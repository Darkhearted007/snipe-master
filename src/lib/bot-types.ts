export type BotMode = "paper" | "live";
export type BotStatus = "idle" | "running" | "paused" | "error";
export type Venue = "raydium" | "pumpfun" | "bsc";
export type DecisionType =
  | "feed"
  | "safety"
  | "strategy"
  | "execution"
  | "learning"
  | "audit"
  | "wallet"
  | "error";

/** Raw token/pool candidate discovered by the Helius webhook pipeline. */
export interface DiscoveryCandidate {
  mint: string;
  decimals: number;
  venue: string;
  symbol: string;
  discovered_at: string;
  safety_score: number | null;
  liquidity_usd: number | null;
}

export interface Opportunity {
  id: string;
  ts: number;
  token: string;
  mint?: string; // real SPL mint address for live-discovered tokens; absent for paper-mode synthetic tokens
  decimals?: number; // SPL token decimals — needed for live swap sizing
  venue: Venue;
  liquiditySol: number;
  safety: number; // -1 = not yet checked; never treat as a passing score
  confidence: number;
  decision: "enter" | "skip";
  reason?: string;
  // Optional enrichment written by live discovery / safety pipelines.
  symbol?: string;
  score?: number;
  safetyScore?: number;
  entryPrice?: number;
  price?: number;
  live?: boolean;
  tokenAddress?: string | null;
  verdict?: "safe" | "caution" | "danger" | "unknown";
}

export interface Position {
  id: string;
  token: string;
  mint?: string;
  decimals?: number; // SPL token decimals, mirrored from the opportunity
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
  // Exit signaling for live positions. Set by tick() when the live price feed
  // has updated `current` past TP or SL. The auto-exit executor reads these
  // to trigger an on-chain sell, then clears them via confirmLiveExit().
  exitRequested?: boolean;
  exitReason?: "tp" | "sl"; // which threshold triggered the exit request
  exitSignature?: string; // set after the on-chain sell confirms
  /** Raw token amount (string, base units) received from the entry buy.
   *  Needed for Jupiter (AMM) sells which require an exact input amount.
   *  Pump.fun bonding-curve sells can omit it (server sells full ATA). */
  tokensReceivedRaw?: string;
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
  /** When true (live mode only), the bot auto-executes swaps for
   *  opportunities that pass all safety gates — no manual Execute click
   *  needed. Requires a connected wallet and live-confirmed acknowledgement.
   *  Off by default so live trading is always opt-in. */
  autoExecute: boolean;
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
  // On-chain signatures for live trades — entry buy and exit sell.
  entrySignature?: string;
  exitSignature?: string;
}

export const PLATFORM_FEE_WALLET = "Gnh9qqJgVGna9yQ8Hc9mzV6bL95Z4eJkmxjPAGkqRnRA";
export const MIN_USER_DEPOSIT_SOL = 0.1;
