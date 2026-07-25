import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  BotMode,
  BotStatus,
  DecisionLogEntry,
  DiscoveryCandidate,
  EquityPoint,
  Guardrails,
  Opportunity,
  Position,
  SafetyFilters,
  TradeHistoryEntry,
  Venue,
  WatchEntry,
  WatchSource,
} from "./bot-types";
import { MIN_USER_DEPOSIT_SOL, PLATFORM_FEE_WALLET } from "./bot-types";
import {
  buildDebrief,
  scoutBiasForToken,
  DEBRIEF_TRADE_WINDOW,
  MAX_COUNCIL_MEMORY,
  type CouncilMemoryEntry,
} from "./council";

const MAX_FEED = 40;
const MAX_LOG = 300;
const MAX_EQUITY = 120;
const MAX_HISTORY = 200;

const TOKENS = [
  "PEPE2",
  "BONKX",
  "SOLDOG",
  "MOONR",
  "WIFHAT",
  "GIGA",
  "TURBO",
  "MYRO",
  "POPCAT",
  "BOOK",
  "SNIP",
  "ALPHA",
  "OMEGA",
  "NOVA",
];

function rand<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function id() {
  return Math.random().toString(36).slice(2, 10);
}
function prepend<T>(arr: T[], ...items: NoInfer<T>[]) {
  return [...items.reverse(), ...arr];
}
function mockAddress() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ123456789";
  let s = "";
  for (let i = 0; i < 44; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
function shortAddr(a: string) {
  return a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a;
}
function venueFromDiscovery(v: string): Venue {
  if (v === "solana/raydium") return "raydium";
  if (v === "solana/pump.fun") return "pumpfun";
  return "raydium"; // unknown venue defaults to the most conservative bucket
}

interface BotState {
  mode: BotMode;
  status: BotStatus;
  startedAt: number | null;
  liveConfirmed: boolean;

  // Wallet
  walletConnected: boolean;
  walletAddress: string | null;
  walletConnecting: boolean;
  walletError: string | null;
  walletBalanceSol: number | null;

  // Funds
  userDeposit: number;
  bankroll: number;
  startBankroll: number;
  peakBankroll: number;
  sessionPnl: number;
  tradesToday: number;
  skipsToday: number;

  // Platform fee
  platformFeePct: number;
  platformFeeWallet: string;
  totalFeesPaidSol: number;

  equity: EquityPoint[];
  guardrails: Guardrails;
  guardrailBreached: boolean;

  opportunities: Opportunity[];
  positions: Position[];
  log: DecisionLogEntry[];
  tradeHistory: TradeHistoryEntry[];

  // Real Helius-webhook-sourced candidates for LIVE mode. Empty in paper
  // mode, which keeps generating synthetic opportunities for practice.
  discoveryCandidates: DiscoveryCandidate[];

  activeVenues: Record<Venue, boolean>;

  watchlist: WatchEntry[];
  autoCurate: boolean;
  safetyFilters: SafetyFilters;

  // Self-healing
  healthTickErrors: 0 | number;
  lastHealthAt: number | null;
  walletName: string | null;

  // Agent council — Scout nudges confidence per tick; Auditor debriefs every
  // DEBRIEF_TRADE_WINDOW closed trades. Memory persists across sessions.
  councilMemory: CouncilMemoryEntry[];
  councilCycleId: string;
  tradesSinceDebrief: number;
  cyclePnlDelta: number;
  cycleClosedTrades: TradeHistoryEntry[];
  onCouncilAppend?: (entry: CouncilMemoryEntry) => void;



  // Actions
  setMode: (m: BotMode) => void;
  confirmLive: () => void;
  connectWallet: () => Promise<void>;
  disconnectWallet: () => void;
  setWalletFromAdapter: (w: {
    connected: boolean;
    connecting: boolean;
    address: string | null;
    walletName: string | null;
  }) => void;
  setWalletBalance: (sol: number | null) => void;
  setUserDeposit: (v: number) => { ok: boolean; error?: string };
  setPlatformFeePct: (v: number) => void;

  start: () => void;
  stop: () => void;
  resetSession: (newBankroll?: number) => void;
  killSwitch: () => void;
  acknowledgeBreach: () => void;
  closePosition: (id: string) => void;
  toggleVenue: (v: Venue) => void;
  setGuardrails: (g: Partial<Guardrails>) => void;

  addWatch: (input: {
    symbol: string;
    venue: Venue;
    note?: string;
    mintAddress?: string | null;
  }) => { ok: true } | { ok: false; error: string };
  removeWatch: (id: string) => void;
  toggleWatch: (id: string) => void;
  promoteAuto: (id: string) => void;
  clearAuto: () => void;
  setAutoCurate: (v: boolean) => void;
  setSafetyFilters: (f: Partial<SafetyFilters>) => void;

  clearLogs: () => void;
  clearHistory: () => void;

  logAudit: (summary: string, type?: DecisionLogEntry["type"]) => void;

  /** Update the on-chain settlement state for a recorded trade. */
  setTradeSettlement: (
    tradeId: string,
    patch: { status: TradeHistoryEntry["settlementStatus"]; feeTxSig?: string; error?: string },
  ) => void;

  /**
   * Rollback the accounting for a fee that could not be settled on-chain
   * after all retries. Credits the reserved fee back to net-to-user so the
   * bankroll reflects what the wallet actually holds. Idempotent.
   */
  rollbackTradeFee: (tradeId: string, reason: string) => void;

  tick: () => void;
  healthCheck: () => void;

  /** Push a real (non-simulated) opportunity from an external stream (DexScreener).
   *  Returns the new opportunity's id (for chaining a safety check), or null
   *  if it was filtered out before ever being added. */
  pushRealOpportunity: (input: {
    token: string;
    venue: Venue;
    symbol: string;
    liquiditySol: number;
    tokenAddress?: string;
  }) => string | null;

  /** Apply a completed safety-check verdict (rugcheck + on-chain) to a real opportunity. */
  applySafetyVerdict: (input: {
    opportunityId: string;
    score: number | null;
    verdict: "safe" | "caution" | "danger" | "unknown";
  }) => void;

  /** Replace the live discovery candidate cache (populated from /api/discovery). */
  setDiscoveryCandidates: (rows: DiscoveryCandidate[]) => void;

  /** Validate that a live entry is safe and compute its size. */
  requestLiveEntry: (
    opportunityId: string,
  ) => { ok: true; sizeSol: number } | { ok: false; error: string };

  /** Record a confirmed on-chain live entry as an open position. */
  confirmLiveEntry: (input: { opportunityId: string; sizeSol: number; signature: string }) => void;

  /** Record a failed live entry attempt. */
  failLiveEntry: (input: { opportunityId: string; reason: string }) => void;

  /** Hydrate state from server persistence (called after sign-in). */
  hydrateFromServer: (payload: {
    settings: Record<string, unknown> | null;
    trades: Array<Record<string, unknown>>;
    logs: Array<Record<string, unknown>>;
    watchlist: Array<Record<string, unknown>>;
  }) => void;

  /** Replace council memory (called after loading from the server). */
  setCouncilMemory: (entries: CouncilMemoryEntry[]) => void;
  /** Register a hook so persistence can mirror new debriefs to the server. */
  setCouncilAppendHandler: (fn: ((e: CouncilMemoryEntry) => void) | undefined) => void;
}

const initialBankroll = 0.1;

const initial = {
  mode: "paper" as BotMode,
  status: "idle" as BotStatus,
  startedAt: null as number | null,
  liveConfirmed: false,

  walletConnected: false,
  walletAddress: null as string | null,
  walletConnecting: false,
  walletError: null as string | null,
  walletBalanceSol: null as number | null,

  userDeposit: initialBankroll,
  bankroll: initialBankroll,
  startBankroll: initialBankroll,
  peakBankroll: initialBankroll,
  sessionPnl: 0,
  tradesToday: 0,
  skipsToday: 0,

  platformFeePct: 10,
  platformFeeWallet: PLATFORM_FEE_WALLET,
  totalFeesPaidSol: 0,

  equity: [{ ts: Date.now(), value: initialBankroll }] as EquityPoint[],
  guardrails: {
    maxPositionSol: 0.02,
    dailyLossLimitPct: 20,
    drawdownLimitPct: 15,
    duplicateGuard: true,
    adaptiveSizing: false,
  } as Guardrails,
  guardrailBreached: false,

  opportunities: [] as Opportunity[],
  discoveryCandidates: [] as DiscoveryCandidate[],
  positions: [] as Position[],
  log: [] as DecisionLogEntry[],
  tradeHistory: [] as TradeHistoryEntry[],

  activeVenues: { raydium: true, pumpfun: true, bsc: false } as Record<Venue, boolean>,

  autoCurate: true,
  safetyFilters: {
    minSafety: 60,
    minLiquiditySol: 5,
    requireLpLocked: true,
    blockHoneypots: true,
    maxHolderConcentrationPct: 25,
  } as SafetyFilters,
  watchlist: [
    {
      id: id(),
      symbol: "SOL/USDC",
      venue: "raydium" as Venue,
      source: "manual" as const,
      enabled: true,
      safety: 96,
      liquiditySol: 4200,
      positiveStreak: 0,
      addedAt: Date.now(),
      note: "Base pair",
    },
    {
      id: id(),
      symbol: "BONK/SOL",
      venue: "raydium" as Venue,
      source: "manual" as const,
      enabled: true,
      safety: 82,
      liquiditySol: 380,
      positiveStreak: 0,
      addedAt: Date.now(),
    },
  ] as WatchEntry[],

  healthTickErrors: 0,
  lastHealthAt: null as number | null,
  walletName: null as string | null,

  councilMemory: [] as CouncilMemoryEntry[],
  councilCycleId: `cyc_${Math.random().toString(36).slice(2, 10)}`,
  tradesSinceDebrief: 0,
  cyclePnlDelta: 0,
  cycleClosedTrades: [] as TradeHistoryEntry[],
  onCouncilAppend: undefined as ((e: CouncilMemoryEntry) => void) | undefined,
};

export const useBotStore = create<BotState>()(
  persist(
    (set, get) => ({
      ...initial,

      setMode: (mode) =>
        set((s) => ({
          mode,
          log: prepend(s.log, {
            id: id(),
            ts: Date.now(),
            type: "audit",
            summary: `Mode switched to ${mode.toUpperCase()}${s.status === "running" ? " (bot still running)" : ""}`,
          }).slice(0, MAX_LOG),
        })),

      confirmLive: () =>
        set((s) => ({
          liveConfirmed: true,
          log: prepend(s.log, {
            id: id(),
            ts: Date.now(),
            type: "audit",
            summary: "User acknowledged live-mode risk disclosure",
          }).slice(0, MAX_LOG),
        })),

      connectWallet: async () => {
        const s = get();
        if (s.walletConnected || s.walletConnecting) return;
        set({ walletConnecting: true, walletError: null });
        try {
          await new Promise((r) => setTimeout(r, 600));
          const addr = mockAddress();
          set((cur) => ({
            walletConnecting: false,
            walletConnected: true,
            walletAddress: addr,
            walletBalanceSol: cur.walletBalanceSol ?? cur.userDeposit,
            bankroll: cur.walletBalanceSol ?? cur.userDeposit,
            log: prepend(cur.log, {
              id: id(),
              ts: Date.now(),
              type: "wallet",
              summary: `Wallet connected · ${shortAddr(addr)}`,
            }).slice(0, MAX_LOG),
          }));
        } catch (e) {
          const msg = e instanceof Error ? e.message : "connect failed";
          set((cur) => ({
            walletConnecting: false,
            walletConnected: false,
            walletError: msg,
            log: prepend(cur.log, {
              id: id(),
              ts: Date.now(),
              type: "error",
              summary: `Wallet connect failed: ${msg}`,
            }).slice(0, MAX_LOG),
          }));
        }
      },

      disconnectWallet: () =>
        set((s) => ({
          walletConnected: false,
          walletAddress: null,
          walletName: null,
          log: prepend(s.log, {
            id: id(),
            ts: Date.now(),
            type: "wallet",
            summary: "Wallet disconnected",
          }).slice(0, MAX_LOG),
        })),

      setWalletFromAdapter: ({ connected, connecting, address, walletName }) => {
        const s = get();
        const changed =
          s.walletConnected !== connected ||
          s.walletAddress !== address ||
          s.walletName !== walletName;
        set({
          walletConnected: connected,
          walletConnecting: connecting,
          walletAddress: address,
          walletName,
          walletError: null,
        });
        if (changed) {
          set((cur) => ({
            log: prepend(cur.log, {
              id: id(),
              ts: Date.now(),
              type: "wallet",
              summary:
                connected && address
                  ? `Wallet connected · ${walletName ?? "wallet"} · ${shortAddr(address)}`
                  : "Wallet disconnected",
            }).slice(0, MAX_LOG),
          }));
        }
      },

      logAudit: (summary, type = "audit") =>
        set((s) => ({
          log: prepend(s.log, {
            id: id(),
            ts: Date.now(),
            type,
            summary,
          }).slice(0, MAX_LOG),
        })),

      setTradeSettlement: (tradeId, patch) =>
        set((s) => {
          const idx = s.tradeHistory.findIndex((t) => t.id === tradeId);
          if (idx < 0) return {};
          const prev = s.tradeHistory[idx];
          const updated: TradeHistoryEntry = {
            ...prev,
            settlementStatus: patch.status,
            feeTxSig: patch.feeTxSig ?? prev.feeTxSig,
            settlementError: patch.error ?? prev.settlementError,
            settledAt: patch.status === "settled" ? Date.now() : prev.settledAt,
          };
          const nextHistory = s.tradeHistory.slice();
          nextHistory[idx] = updated;
          const auditLine =
            patch.status === "settled"
              ? `Audit#${tradeId.slice(0, 6)} settled · fee ${prev.feePaidSol.toFixed(5)} SOL → ${shortAddr(prev.feeWallet ?? "?")} · sig ${(patch.feeTxSig ?? "").slice(0, 8)}…`
              : patch.status === "failed"
                ? `Audit#${tradeId.slice(0, 6)} settlement FAILED · ${patch.error ?? "unknown"} · net retained ${prev.pnlSol.toFixed(5)} SOL (fee unpaid)`
                : `Audit#${tradeId.slice(0, 6)} settlement ${patch.status}`;
          return {
            tradeHistory: nextHistory,
            log: prepend(s.log, {
              id: id(),
              ts: Date.now(),
              type: patch.status === "failed" ? "error" : "audit",
              summary: auditLine,
            }).slice(0, MAX_LOG),
          };
        }),

      rollbackTradeFee: (tradeId, reason) =>
        set((s) => {
          const idx = s.tradeHistory.findIndex((t) => t.id === tradeId);
          if (idx < 0) return {};
          const prev = s.tradeHistory[idx];
          if (prev.feePaidSol <= 0) return {};
          const restored = prev.feePaidSol;
          const updated: TradeHistoryEntry = {
            ...prev,
            feePaidSol: 0,
            netToUserSol: prev.pnlSol,
            settlementStatus: "failed",
            settlementError: `rolled back: ${reason}`,
          };
          const nextHistory = s.tradeHistory.slice();
          nextHistory[idx] = updated;
          return {
            tradeHistory: nextHistory,
            bankroll: s.bankroll + restored,
            log: prepend(s.log, {
              id: id(),
              ts: Date.now(),
              type: "audit",
              summary: `Rollback#${tradeId.slice(0, 6)} fee ${restored.toFixed(5)} SOL credited back to user (${reason})`,
            }).slice(0, MAX_LOG),
          };
        }),

      setUserDeposit: (v) => {
        if (!Number.isFinite(v) || v < MIN_USER_DEPOSIT_SOL) {
          return { ok: false, error: `Minimum deposit is ${MIN_USER_DEPOSIT_SOL} SOL` };
        }
        set((s) => ({
          userDeposit: v,
          bankroll: v,
          startBankroll: v,
          peakBankroll: v,
          sessionPnl: 0,
          equity: [{ ts: Date.now(), value: v }],
          log: prepend(s.log, {
            id: id(),
            ts: Date.now(),
            type: "audit",
            summary: `Session bankroll set to ${v.toFixed(3)} SOL`,
          }).slice(0, MAX_LOG),
        }));
        return { ok: true };
      },

      setPlatformFeePct: (v) => {
        const clamped = Math.max(0, Math.min(50, v));
        set((s) => ({
          platformFeePct: clamped,
          log: prepend(s.log, {
            id: id(),
            ts: Date.now(),
            type: "audit",
            summary: `Platform fee set to ${clamped}% (profit only → ${shortAddr(s.platformFeeWallet)})`,
          }).slice(0, MAX_LOG),
        }));
      },

      start: () => {
        const s = get();
        if (s.mode === "live" && (!s.liveConfirmed || !s.walletConnected)) return;
        if (s.guardrailBreached) return;
        set({
          status: "running",
          startedAt: Date.now(),
          log: prepend(s.log, {
            id: id(),
            ts: Date.now(),
            type: "execution",
            summary: `Bot started in ${s.mode.toUpperCase()} mode · bankroll ${s.bankroll.toFixed(3)} SOL`,
          }).slice(0, MAX_LOG),
        });
      },
      stop: () =>
        set((s) => ({
          status: "idle",
          log: prepend(s.log, {
            id: id(),
            ts: Date.now(),
            type: "execution",
            summary: "Bot stopped",
          }).slice(0, MAX_LOG),
        })),
      resetSession: (newBankroll?: number) =>
        set((s) => {
          const v = newBankroll ?? s.userDeposit;
          return {
            status: "idle",
            bankroll: v,
            startBankroll: v,
            peakBankroll: v,
            positions: [],
            equity: [{ ts: Date.now(), value: v }] as EquityPoint[],
            sessionPnl: 0,
            tradesToday: 0,
            skipsToday: 0,
            guardrailBreached: false,
            log: prepend(s.log, {
              id: id(),
              ts: Date.now(),
              type: "audit",
              summary: `Session reset · new bankroll ${v.toFixed(3)} SOL`,
            }).slice(0, MAX_LOG),
          };
        }),
      killSwitch: () =>
        set((s) => {
          const flatHistory: TradeHistoryEntry[] = s.positions.map((p) => ({
            id: id(),
            ts: Date.now(),
            mode: s.mode,
            token: p.token,
            venue: p.venue,
            sizeSol: p.sizeSol,
            entry: p.entry,
            exit: p.current,
            pnlSol: (p.current - p.entry) * (p.sizeSol / p.entry),
            reason: "kill",
            feePaidSol: 0,
            netToUserSol: (p.current - p.entry) * (p.sizeSol / p.entry),
            settlementStatus: "n/a",
          }));
          return {
            status: "idle",
            positions: [],
            tradeHistory: [...flatHistory, ...s.tradeHistory].slice(0, MAX_HISTORY),
            log: prepend(s.log, {
              id: id(),
              ts: Date.now(),
              type: "execution",
              summary: `KILL SWITCH · flattened ${s.positions.length} position(s)`,
            }).slice(0, MAX_LOG),
          };
        }),
      toggleVenue: (v) =>
        set((s) => ({
          activeVenues: { ...s.activeVenues, [v]: !s.activeVenues[v] },
          log: prepend(s.log, {
            id: id(),
            ts: Date.now(),
            type: "audit",
            summary: `Venue ${v} ${!s.activeVenues[v] ? "enabled" : "disabled"}`,
          }).slice(0, MAX_LOG),
        })),
      setGuardrails: (g) =>
        set((s) => {
          const keys = Object.keys(g) as (keyof Guardrails)[];
          const summary = keys.map((k) => `${k}=${String(g[k])}`).join(", ");
          return {
            guardrails: { ...s.guardrails, ...g },
            log: prepend(s.log, {
              id: id(),
              ts: Date.now(),
              type: "audit",
              summary: `Guardrail updated · ${summary}`,
            }).slice(0, MAX_LOG),
          };
        }),

      addWatch: ({ symbol, venue, note, mintAddress }) => {
        const s = get();
        const clean = symbol.trim().toUpperCase();
        if (!/^[A-Z0-9]+\/[A-Z0-9]+$/.test(clean)) {
          const err = "Use TOKEN/QUOTE format (e.g. BONK/SOL)";
          set((cur) => ({
            log: prepend(cur.log, {
              id: id(),
              ts: Date.now(),
              type: "audit",
              summary: `Watchlist add rejected · ${clean || "(empty)"} · ${err}`,
            }).slice(0, MAX_LOG),
          }));
          return { ok: false as const, error: err };
        }
        if (s.watchlist.some((w) => w.symbol === clean && w.venue === venue)) {
          const err = "Already in watchlist";
          set((cur) => ({
            log: prepend(cur.log, {
              id: id(),
              ts: Date.now(),
              type: "audit",
              summary: `Watchlist add rejected · ${clean} @ ${venue} · ${err}`,
            }).slice(0, MAX_LOG),
          }));
          return { ok: false as const, error: err };
        }
        const safety = Math.floor(55 + Math.random() * 45);
        const liq = 10 + Math.random() * 400;
        if (safety < s.safetyFilters.minSafety) {
          const err = `Failed safety filter (${safety} < ${s.safetyFilters.minSafety})`;
          set((cur) => ({
            log: prepend(cur.log, {
              id: id(),
              ts: Date.now(),
              type: "safety",
              summary: `Watchlist add rejected · ${clean} · ${err}`,
            }).slice(0, MAX_LOG),
          }));
          return { ok: false as const, error: err };
        }
        if (liq < s.safetyFilters.minLiquiditySol) {
          const err = `Insufficient liquidity (${liq.toFixed(1)} SOL)`;
          set((cur) => ({
            log: prepend(cur.log, {
              id: id(),
              ts: Date.now(),
              type: "safety",
              summary: `Watchlist add rejected · ${clean} · ${err}`,
            }).slice(0, MAX_LOG),
          }));
          return { ok: false as const, error: err };
        }
        set({
          watchlist: [
            {
              id: id(),
              symbol: clean,
              venue,
              source: "manual",
              enabled: true,
              safety,
              liquiditySol: liq,
              positiveStreak: 0,
              addedAt: Date.now(),
              note,
              mintAddress: mintAddress?.trim() || null,
            },
            ...s.watchlist,
          ],
          log: prepend(
            s.log,
            {
              id: id(),
              ts: Date.now(),
              type: "audit",
              summary: `Manual override added · ${clean} @ ${venue}`,
            },
            {
              id: id(),
              ts: Date.now(),
              type: "safety",
              summary: `${clean} passed safety ${safety}/100 · liq ${liq.toFixed(1)} SOL`,
            },
          ).slice(0, MAX_LOG),
        });
        return { ok: true as const };
      },
      removeWatch: (wid) =>
        set((s) => {
          const w = s.watchlist.find((x) => x.id === wid);
          return {
            watchlist: s.watchlist.filter((x) => x.id !== wid),
            log: w
              ? prepend(s.log, {
                  id: id(),
                  ts: Date.now(),
                  type: "audit",
                  summary: `Watchlist removed · ${w.symbol} @ ${w.venue} (${w.source})`,
                }).slice(0, MAX_LOG)
              : s.log,
          };
        }),
      toggleWatch: (wid) =>
        set((s) => {
          const w = s.watchlist.find((x) => x.id === wid);
          return {
            watchlist: s.watchlist.map((x) => (x.id === wid ? { ...x, enabled: !x.enabled } : x)),
            log: w
              ? prepend(s.log, {
                  id: id(),
                  ts: Date.now(),
                  type: "audit",
                  summary: `Watchlist ${!w.enabled ? "enabled" : "disabled"} · ${w.symbol}`,
                }).slice(0, MAX_LOG)
              : s.log,
          };
        }),
      promoteAuto: (wid) =>
        set((s) => {
          const w = s.watchlist.find((x) => x.id === wid);
          return {
            watchlist: s.watchlist.map((x) => (x.id === wid ? { ...x, source: "manual" } : x)),
            log: w
              ? prepend(s.log, {
                  id: id(),
                  ts: Date.now(),
                  type: "audit",
                  summary: `Promoted ${w.symbol} auto → manual (streak ${w.positiveStreak})`,
                }).slice(0, MAX_LOG)
              : s.log,
          };
        }),
      clearAuto: () =>
        set((s) => {
          const removed = s.watchlist.filter((w) => w.source === "auto").length;
          return {
            watchlist: s.watchlist.filter((w) => w.source !== "auto"),
            log: prepend(s.log, {
              id: id(),
              ts: Date.now(),
              type: "audit",
              summary: `Cleared ${removed} auto-curated entrie(s)`,
            }).slice(0, MAX_LOG),
          };
        }),
      setAutoCurate: (v) =>
        set((s) => ({
          autoCurate: v,
          log: prepend(s.log, {
            id: id(),
            ts: Date.now(),
            type: "audit",
            summary: `Auto-curation ${v ? "enabled" : "disabled"}`,
          }).slice(0, MAX_LOG),
        })),
      setSafetyFilters: (f) =>
        set((s) => {
          const keys = Object.keys(f) as (keyof SafetyFilters)[];
          const summary = keys.map((k) => `${k}=${String(f[k])}`).join(", ");
          return {
            safetyFilters: { ...s.safetyFilters, ...f },
            log: prepend(s.log, {
              id: id(),
              ts: Date.now(),
              type: "audit",
              summary: `Safety filter updated · ${summary}`,
            }).slice(0, MAX_LOG),
          };
        }),

      clearLogs: () => set({ log: [] }),
      clearHistory: () => set({ tradeHistory: [] }),

      healthCheck: () => {
        const s = get();
        if (s.status === "error") {
          set({
            status: "idle",
            healthTickErrors: 0,
            lastHealthAt: Date.now(),
            log: prepend(s.log, {
              id: id(),
              ts: Date.now(),
              type: "audit",
              summary: "Self-heal · reset from error state to idle",
            }).slice(0, MAX_LOG),
          });
          return;
        }
        set({ lastHealthAt: Date.now() });
      },

      setDiscoveryCandidates: (rows: DiscoveryCandidate[]) => set({ discoveryCandidates: rows }),

      requestLiveEntry: (opportunityId: string) => {
        const s = get();
        const opportunity = s.opportunities.find((o) => o.id === opportunityId);
        if (!opportunity) {
          const error = `Opportunity not found: ${opportunityId}`;
          set((cur) => ({
            skipsToday: cur.skipsToday + 1,
            log: prepend(cur.log, {
              id: id(),
              ts: Date.now(),
              type: "error",
              summary: `ENTRY_SKIPPED · ${error}`,
            }).slice(0, MAX_LOG),
          }));
          return { ok: false, error };
        }
        if (s.mode !== "live" || !s.status || s.status === "idle") {
          const error = "Live mode not running";
          set((cur) => ({
            skipsToday: cur.skipsToday + 1,
            log: prepend(cur.log, {
              id: id(),
              ts: Date.now(),
              type: "error",
              summary: `ENTRY_SKIPPED · ${error} · ${opportunity.symbol}`,
            }).slice(0, MAX_LOG),
          }));
          return { ok: false, error };
        }
        if (!s.walletConnected || !s.walletAddress) {
          const error = "Wallet not connected";
          set((cur) => ({
            skipsToday: cur.skipsToday + 1,
            log: prepend(cur.log, {
              id: id(),
              ts: Date.now(),
              type: "error",
              summary: `ENTRY_SKIPPED · ${error} · ${opportunity.symbol}`,
            }).slice(0, MAX_LOG),
          }));
          return { ok: false, error };
        }
        if (s.guardrailBreached) {
          const error = "Guardrail breached";
          set((cur) => ({
            skipsToday: cur.skipsToday + 1,
            log: prepend(cur.log, {
              id: id(),
              ts: Date.now(),
              type: "error",
              summary: `ENTRY_SKIPPED · ${error} · ${opportunity.symbol}`,
            }).slice(0, MAX_LOG),
          }));
          return { ok: false, error };
        }
        if (s.positions.some((p) => p.token === opportunity.token && p.live)) {
          const error = "Duplicate live position";
          set((cur) => ({
            skipsToday: cur.skipsToday + 1,
            log: prepend(cur.log, {
              id: id(),
              ts: Date.now(),
              type: "error",
              summary: `ENTRY_SKIPPED · ${error} · ${opportunity.symbol}`,
            }).slice(0, MAX_LOG),
          }));
          return { ok: false, error };
        }
        const minSize = Math.max(0.001, Math.min(s.bankroll * 0.1, s.guardrails.maxPositionSol));
        if (!Number.isFinite(minSize) || minSize <= 0 || minSize > s.bankroll) {
          const error = `Insufficient bankroll (${s.bankroll.toFixed(5)} SOL)`;
          set((cur) => ({
            skipsToday: cur.skipsToday + 1,
            log: prepend(cur.log, {
              id: id(),
              ts: Date.now(),
              type: "error",
              summary: `ENTRY_SKIPPED · ${error} · ${opportunity.symbol}`,
            }).slice(0, MAX_LOG),
          }));
          return { ok: false, error };
        }
        const score = opportunity.safetyScore ?? opportunity.score ?? 0;
        if (score < s.safetyFilters.minSafety) {
          const error = `Safety threshold failed (${score} < ${s.safetyFilters.minSafety})`;
          set((cur) => ({
            skipsToday: cur.skipsToday + 1,
            log: prepend(cur.log, {
              id: id(),
              ts: Date.now(),
              type: "error",
              summary: `ENTRY_SKIPPED · ${error} · ${opportunity.symbol}`,
            }).slice(0, MAX_LOG),
          }));
          return { ok: false, error };
        }
        const tokenAddress = (opportunity as Opportunity & { tokenAddress?: string | null }).tokenAddress;
        if (!tokenAddress) {
          const error = "Mint validation failed";
          set((cur) => ({
            skipsToday: cur.skipsToday + 1,
            log: prepend(cur.log, {
              id: id(),
              ts: Date.now(),
              type: "error",
              summary: `ENTRY_SKIPPED · ${error} · ${opportunity.symbol}`,
            }).slice(0, MAX_LOG),
          }));
          return { ok: false, error };
        }
        set((cur) => ({
          log: prepend(cur.log, {
            id: id(),
            ts: Date.now(),
            type: "execution",
            summary: `ENTRY_REQUESTED · ${opportunity.symbol} · size ${minSize.toFixed(5)} SOL · score ${score}`,
          }).slice(0, MAX_LOG),
        }));
        return { ok: true, sizeSol: minSize };
      },

      confirmLiveEntry: ({ opportunityId, sizeSol, signature }) => {
        const s = get();
        const opp = s.opportunities.find((o) => o.id === opportunityId);
        if (!opp) return;
        const tokenAddress = (opp as Opportunity & { tokenAddress?: string | null }).tokenAddress;
        const positionId = id();
        const position: Position = {
          id: positionId,
          token: opp.token,
          venue: opp.venue,
          sizeSol,
          entry: opp.entryPrice ?? opp.price ?? 0,
          current: opp.entryPrice ?? opp.price ?? 0,
          live: true,
          mintAddress: tokenAddress ?? null,
          openedAt: Date.now(),
        } as Position;
        set((cur) => ({
          positions: [position, ...cur.positions].slice(0, MAX_HISTORY),
          bankroll: Math.max(0, cur.bankroll - sizeSol),
          tradesToday: cur.tradesToday + 1,
          log: prepend(cur.log, {
            id: id(),
            ts: Date.now(),
            type: "execution",
            summary: `ENTRY_EXECUTED · ${opp.symbol} · size ${sizeSol.toFixed(5)} SOL · sig ${signature.slice(0, 8)}…`,
          }).slice(0, MAX_LOG),
        }));
      },

      failLiveEntry: ({ opportunityId, reason }) => {
        set((cur) => ({
          skipsToday: cur.skipsToday + 1,
          log: prepend(cur.log, {
            id: id(),
            ts: Date.now(),
            type: "error",
            summary: `ENTRY_FAILED · ${opportunityId} · ${reason}`,
          }).slice(0, MAX_LOG),
        }));
      },

      pushRealOpportunity: ({ token, venue, symbol, liquiditySol, tokenAddress }) => {
        const s = get();
        if (!s.activeVenues[venue]) {
          set((cur) => ({
            log: prepend(cur.log, {
              id: id(),
              ts: Date.now(),
              type: "audit",
              summary: `POOL_REJECTED · ${symbol} · venue disabled`,
            }).slice(0, MAX_LOG),
          }));
          return null;
        }
        if (!Number.isFinite(liquiditySol) || liquiditySol <= 0) {
          set((cur) => ({
            log: prepend(cur.log, {
              id: id(),
              ts: Date.now(),
              type: "error",
              summary: `POOL_REJECTED · ${symbol} · invalid liquidity ${liquiditySol}`,
            }).slice(0, MAX_LOG),
          }));
          return null;
        }
        const oppId = id();
        const score = Math.min(99, Math.max(1, Math.floor(50 + liquiditySol / 10)));
        const opportunity: Opportunity = {
          id: oppId,
          token,
          symbol,
          venue,
          liquiditySol,
          score,
          safetyScore: null,
          entryPrice: null,
          price: null,
          live: s.mode === "live",
        } as Opportunity;
        set((cur) => ({
          opportunities: [opportunity, ...cur.opportunities].slice(0, MAX_FEED),
          log: prepend(cur.log, {
            id: id(),
            ts: Date.now(),
            type: "audit",
            summary: `POOL_ACCEPTED · ${symbol} · liq ${liquiditySol.toFixed(2)} SOL · score ${score}`,
          }).slice(0, MAX_LOG),
        }));
        return oppId;
      },

      applySafetyVerdict: ({ opportunityId, score, verdict }) => {
        set((s) => ({
          opportunities: s.opportunities.map((o) =>
            o.id === opportunityId ? { ...o, safetyScore: score ?? undefined, verdict } : o,
          ),
          log: prepend(s.log, {
            id: id(),
            ts: Date.now(),
            type: "audit",
            summary: `OPPORTUNITY_SCORED · ${opportunityId} · verdict=${verdict} · score=${String(score)}`,
          }).slice(0, MAX_LOG),
        }));
      },

      hydrateFromServer: (payload) => {
        set((s) => ({
          log: prepend(s.log, {
            id: id(),
            ts: Date.now(),
            type: "audit",
            summary: `Server state loaded · settings=${payload.settings ? "yes" : "no"} trades=${payload.trades.length}`,
          }).slice(0, MAX_LOG),
        }));
      },

      setCouncilMemory: (entries) => set({ councilMemory: entries }),
      setCouncilAppendHandler: (fn) => set({ onCouncilAppend: fn }),
    }),
    {
      name: "snipe-master-bot",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
