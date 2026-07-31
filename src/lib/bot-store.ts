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

// Synthetic symbols for paper-mode's local candidate generator only — not
// real mints, never touches live trading. Expanded for more feed variety.
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
  "ZAPX",
  "FROGE",
  "LAZR",
  "COMET",
  "DEGEN2",
  "SHRIMPX",
  "VOLT",
  "PIXEL",
  "RUGX",
  "GHOST",
  "APEX2",
  "FLUX",
  "CROWN",
  "ECHO",
  "BLAZE",
  "ORBIT",
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
  return "raydium";
}

/** Logs a rejected live-entry attempt as an audit-visible ENTRY_SKIPPED
 *  event (instead of only surfacing via a toast the clicking user sees),
 *  and counts it toward skipsToday. Called from requestLiveEntry only —
 *  never from checkLiveEntry, which must stay a pure/no-write function
 *  safe to call during render. */
function guardrailReject(cur: BotState, reason: string, opportunityId?: string, symbol?: string) {
  return {
    skipsToday: cur.skipsToday + 1,
    log: prepend(cur.log, {
      id: id(),
      ts: Date.now(),
      type: "error" as const,
      summary: `ENTRY_SKIPPED${symbol ? ` · ${symbol}` : ""}${opportunityId ? ` · ${opportunityId}` : ""} · ${reason}`,
    }).slice(0, MAX_LOG),
  };
}

interface BotState {
  mode: BotMode;
  status: BotStatus;
  startedAt: number | null;
  liveConfirmed: boolean;
  walletConnected: boolean;
  walletAddress: string | null;
  walletConnecting: boolean;
  walletError: string | null;
  walletBalanceSol: number | null;
  userDeposit: number;
  bankroll: number;
  startBankroll: number;
  peakBankroll: number;
  sessionPnl: number;
  tradesToday: number;
  skipsToday: number;
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
  discoveryCandidates: DiscoveryCandidate[];
  activeVenues: Record<Venue, boolean>;
  watchlist: WatchEntry[];
  autoCurate: boolean;
  safetyFilters: SafetyFilters;
  healthTickErrors: 0 | number;
  lastHealthAt: number | null;
  walletName: string | null;
  councilMemory: CouncilMemoryEntry[];
  councilCycleId: string;
  tradesSinceDebrief: number;
  cyclePnlDelta: number;
  cycleClosedTrades: TradeHistoryEntry[];
  onCouncilAppend?: (entry: CouncilMemoryEntry) => void;
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
  setTradeSettlement: (
    tradeId: string,
    patch: { status: TradeHistoryEntry["settlementStatus"]; feeTxSig?: string; error?: string },
  ) => void;
  rollbackTradeFee: (tradeId: string, reason: string) => void;
  tick: () => void;
  healthCheck: () => void;
  pushRealOpportunity: (input: {
    token: string;
    venue: Venue;
    symbol: string;
    liquiditySol: number;
    tokenAddress?: string;
  }) => string | null;
  applySafetyVerdict: (input: {
    opportunityId: string;
    score: number | null;
    verdict: "safe" | "caution" | "danger" | "unknown";
  }) => void;
  setDiscoveryCandidates: (rows: DiscoveryCandidate[]) => void;
  /** Pure eligibility check — no state writes. Safe to call during render
   *  (e.g. to gate a button's disabled/tooltip state). Use requestLiveEntry
   *  for the actual commit, which additionally logs ENTRY_REQUESTED. */
  checkLiveEntry: (
    opportunityId: string,
  ) => { ok: true; sizeSol: number } | { ok: false; error: string };
  requestLiveEntry: (
    opportunityId: string,
  ) => { ok: true; sizeSol: number } | { ok: false; error: string };
  confirmLiveEntry: (input: { opportunityId: string; sizeSol: number; signature: string }) => void;
  failLiveEntry: (input: { opportunityId: string; reason: string }) => void;
  hydrateFromServer: (payload: {
    settings: Record<string, unknown> | null;
    trades: Array<Record<string, unknown>>;
    logs: Array<Record<string, unknown>>;
    watchlist: Array<Record<string, unknown>>;
  }) => void;
  setCouncilMemory: (entries: CouncilMemoryEntry[]) => void;
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
  watchlist: [],
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
          set((cur) => {
            const balance = cur.walletBalanceSol ?? cur.userDeposit;
            return {
              walletConnecting: false,
              walletConnected: true,
              walletAddress: addr,
              walletBalanceSol: balance,
              bankroll: balance,
              startBankroll: balance,
              peakBankroll: balance,
              equity: [{ ts: Date.now(), value: balance }],
              guardrailBreached: false,
              log: prepend(cur.log, {
                id: id(),
                ts: Date.now(),
                type: "wallet",
                summary: `Wallet connected · ${shortAddr(addr)}`,
              }).slice(0, MAX_LOG),
            };
          });
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
        if (changed)
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
      },
      setWalletBalance: (sol) =>
        set((s) => {
          const next = sol == null ? s.bankroll : Math.max(0, sol);
          return {
            walletBalanceSol: sol,
            bankroll: next,
            startBankroll: next,
            peakBankroll: Math.max(s.peakBankroll, next),
            equity: [{ ts: Date.now(), value: next }, ...s.equity].slice(0, MAX_EQUITY),
            guardrailBreached: false,
            log: prepend(s.log, {
              id: id(),
              ts: Date.now(),
              type: "audit",
              summary: `Wallet bankroll synced · ${next.toFixed(6)} SOL${sol == null ? " (fallback)" : ""}`,
            }).slice(0, MAX_LOG),
          };
        }),
      setUserDeposit: (v) => {
        if (!Number.isFinite(v) || v < MIN_USER_DEPOSIT_SOL)
          return { ok: false, error: `Minimum deposit is ${MIN_USER_DEPOSIT_SOL} SOL` };
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
      acknowledgeBreach: () =>
        set((s) => ({
          guardrailBreached: false,
          status: s.status === "paused" ? "idle" : s.status,
          log: prepend(s.log, {
            id: id(),
            ts: Date.now(),
            type: "audit",
            summary: "Guardrail breach acknowledged — bot may resume",
          }).slice(0, MAX_LOG),
        })),
      closePosition: (pid) =>
        set((s) => {
          const p = s.positions.find((x) => x.id === pid);
          if (!p) return {};
          const pnl = (p.current - p.entry) * (p.sizeSol / p.entry);
          const fee = s.mode === "live" && pnl > 0 ? pnl * (s.platformFeePct / 100) : 0;
          const net = pnl - fee;
          const bankroll = s.bankroll + p.sizeSol + net;
          const walletBalanceSol =
            s.walletBalanceSol == null ? null : Math.max(0, s.walletBalanceSol + p.sizeSol + net);
          const entry: TradeHistoryEntry = {
            id: id(),
            ts: Date.now(),
            mode: s.mode,
            token: p.token,
            venue: p.venue,
            sizeSol: p.sizeSol,
            entry: p.entry,
            exit: p.current,
            pnlSol: pnl,
            reason: "manual",
            feePaidSol: fee,
            netToUserSol: net,
            feeWallet: fee > 0 ? s.platformFeeWallet : undefined,
            settlementStatus: fee > 0 ? "pending" : "n/a",
          };
          return {
            positions: s.positions.filter((x) => x.id !== pid),
            bankroll,
            walletBalanceSol,
            sessionPnl: bankroll - s.startBankroll,
            peakBankroll: Math.max(s.peakBankroll, bankroll),
            totalFeesPaidSol: s.totalFeesPaidSol + fee,
            tradeHistory: [entry, ...s.tradeHistory].slice(0, MAX_HISTORY),
            log: prepend(
              s.log,
              {
                id: id(),
                ts: Date.now(),
                type: "execution",
                summary: `Manual close ${p.token} · pnl ${pnl >= 0 ? "+" : ""}${pnl.toFixed(5)} SOL${fee > 0 ? ` · fee ${fee.toFixed(5)}` : ""}`,
              },
              {
                id: id(),
                ts: Date.now(),
                type: "audit" as const,
                summary: `Audit#${entry.id.slice(0, 6)} ${s.mode.toUpperCase()} ${p.token} · pnl ${pnl >= 0 ? "+" : ""}${pnl.toFixed(5)} SOL · fee ${fee.toFixed(5)} SOL (${s.platformFeePct}%) · net ${net.toFixed(5)} SOL · settlement=${fee > 0 ? "pending" : "n/a"}`,
              },
              ...(fee > 0
                ? [
                    {
                      id: id(),
                      ts: Date.now(),
                      type: "audit" as const,
                      summary: `Fee ${fee.toFixed(5)} SOL → ${shortAddr(s.platformFeeWallet)}`,
                    },
                  ]
                : []),
            ).slice(0, MAX_LOG),
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
        set((s) => ({
          guardrails: { ...s.guardrails, ...g },
          guardrailBreached: false,
          log: prepend(s.log, {
            id: id(),
            ts: Date.now(),
            type: "audit",
            summary: `Guardrail updated · ${Object.keys(g)
              .map((k) => `${k}=${String(g[k as keyof Guardrails])}`)
              .join(", ")}`,
          }).slice(0, MAX_LOG),
        })),
      addWatch: ({ symbol, venue, note, mintAddress }) => {
        const s = get();
        const clean = symbol.trim().toUpperCase();
        if (!/^[A-Z0-9]+\/[A-Z0-9]+$/.test(clean))
          return { ok: false as const, error: "Use TOKEN/QUOTE format (e.g. BONK/SOL)" };
        if (s.watchlist.some((w) => w.symbol === clean && w.venue === venue))
          return { ok: false as const, error: "Already in watchlist" };
        set({
          watchlist: [
            {
              id: id(),
              symbol: clean,
              venue,
              source: "manual",
              enabled: true,
              safety: 80,
              liquiditySol: 10,
              positiveStreak: 0,
              addedAt: Date.now(),
              note,
              mintAddress: mintAddress?.trim() || null,
            },
            ...s.watchlist,
          ],
          log: prepend(s.log, {
            id: id(),
            ts: Date.now(),
            type: "audit",
            summary: `Manual override added · ${clean} @ ${venue}`,
          }).slice(0, MAX_LOG),
        });
        return { ok: true as const };
      },
      removeWatch: (wid) => set((s) => ({ watchlist: s.watchlist.filter((x) => x.id !== wid) })),
      toggleWatch: (wid) =>
        set((s) => ({
          watchlist: s.watchlist.map((x) => (x.id === wid ? { ...x, enabled: !x.enabled } : x)),
        })),
      promoteAuto: (wid) =>
        set((s) => ({
          watchlist: s.watchlist.map((x) => (x.id === wid ? { ...x, source: "manual" } : x)),
        })),
      clearAuto: () => set((s) => ({ watchlist: s.watchlist.filter((w) => w.source !== "auto") })),
      setAutoCurate: (v) => set({ autoCurate: v }),
      setSafetyFilters: (f) =>
        set((s) => ({ safetyFilters: { ...s.safetyFilters, ...f }, guardrailBreached: false })),
      clearLogs: () => set({ log: [] }),
      clearHistory: () => set({ tradeHistory: [] }),
      logAudit: (summary, type = "audit") =>
        set((s) => ({
          log: prepend(s.log, { id: id(), ts: Date.now(), type, summary }).slice(0, MAX_LOG),
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
          return {
            tradeHistory: nextHistory,
            log: prepend(s.log, {
              id: id(),
              ts: Date.now(),
              type: patch.status === "failed" ? "error" : "audit",
              summary:
                patch.status === "settled"
                  ? `Audit#${tradeId.slice(0, 6)} settled · fee ${prev.feePaidSol.toFixed(5)} SOL → ${shortAddr(prev.feeWallet ?? "?")} · sig ${(patch.feeTxSig ?? "").slice(0, 8)}…`
                  : patch.status === "failed"
                    ? `Audit#${tradeId.slice(0, 6)} settlement FAILED · ${patch.error ?? "unknown"} · net retained ${prev.pnlSol.toFixed(5)} SOL (fee unpaid)`
                    : `Audit#${tradeId.slice(0, 6)} settlement ${patch.status}`,
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
            walletBalanceSol: s.walletBalanceSol == null ? null : s.walletBalanceSol + restored,
            guardrailBreached: false,
            log: prepend(s.log, {
              id: id(),
              ts: Date.now(),
              type: "audit",
              summary: `Rollback#${tradeId.slice(0, 6)} fee ${restored.toFixed(5)} SOL credited back to user (${reason})`,
            }).slice(0, MAX_LOG),
          };
        }),
      tick: () => {
        const s = get();
        if (s.status !== "running" || s.guardrailBreached) return;

        // ---- 1. price walk + tp/sl exits -------------------------------
        const closed: TradeHistoryEntry[] = [];
        const remaining: Position[] = [];
        let bankroll = s.bankroll;
        let walletBalanceSol = s.walletBalanceSol;
        let fees = 0;
        const exitLogs: DecisionLogEntry[] = [];

        for (const p of s.positions) {
          // Live positions are backed by a real on-chain swap — never
          // random-walk their notional price or compute simulated pnl from
          // synthetic drift. Their `current` stays at entry until a real
          // exit (manual close or a live price feed) updates it. This keeps
          // the equity curve honest and prevents fake TP/SL triggers.
          if (p.live) {
            remaining.push(p);
            continue;
          }
          const drift = (Math.random() - 0.48) * 0.035;
          const current = Math.max(1e-9, p.current * (1 + drift));
          const hitTp = p.tp > 0 && current >= p.tp;
          const hitSl = p.sl > 0 && current <= p.sl;
          if (!hitTp && !hitSl) {
            remaining.push({ ...p, current });
            continue;
          }
          const pnl = (current - p.entry) * (p.sizeSol / p.entry);
          const fee = s.mode === "live" && pnl > 0 ? pnl * (s.platformFeePct / 100) : 0;
          const net = pnl - fee;
          fees += fee;
          bankroll = bankroll + p.sizeSol + net;
          if (walletBalanceSol != null)
            walletBalanceSol = Math.max(0, walletBalanceSol + p.sizeSol + net);
          const entry: TradeHistoryEntry = {
            id: id(),
            ts: Date.now(),
            mode: s.mode,
            token: p.token,
            venue: p.venue,
            sizeSol: p.sizeSol,
            entry: p.entry,
            exit: current,
            pnlSol: pnl,
            reason: hitTp ? "tp" : "sl",
            feePaidSol: fee,
            netToUserSol: net,
            feeWallet: fee > 0 ? s.platformFeeWallet : undefined,
            settlementStatus: fee > 0 ? "pending" : "n/a",
          };
          closed.push(entry);
          exitLogs.push({
            id: id(),
            ts: Date.now(),
            type: "execution",
            summary: `EXIT ${hitTp ? "TP" : "SL"} ${p.token} · pnl ${pnl >= 0 ? "+" : ""}${pnl.toFixed(5)} SOL${fee > 0 ? ` · fee ${fee.toFixed(5)}` : ""}`,
          });
        }

        // ---- 2. discover a candidate ----------------------------------
        const newOpportunities: Opportunity[] = [];
        const feedLogs: DecisionLogEntry[] = [];
        const enabledVenues = (Object.keys(s.activeVenues) as Venue[]).filter(
          (v) => s.activeVenues[v],
        );

        if (enabledVenues.length && Math.random() < 0.6) {
          let token: string;
          let venue: Venue;
          let liquiditySol: number;
          let safety: number;
          let mint: string | undefined;
          let decimals: number | undefined;

          if (s.mode === "live") {
            const pool = s.discoveryCandidates.filter(
              (c) =>
                !s.opportunities.some((o) => o.mint === c.mint) &&
                enabledVenues.includes(venueFromDiscovery(c.venue)),
            );
            if (!pool.length) return applyTick();
            const c = rand(pool);
            token = c.symbol || c.mint.slice(0, 6);
            venue = venueFromDiscovery(c.venue);
            liquiditySol = (c.liquidity_usd ?? 0) / 150;
            safety = c.safety_score ?? -1;
            mint = c.mint;
            decimals = c.decimals;
          } else {
            token = rand(TOKENS);
            venue = rand(enabledVenues);
            liquiditySol = 3 + Math.random() * 120;
            safety = Math.floor(40 + Math.random() * 60);
          }

          const bias = scoutBiasForToken(s.councilMemory, token);
          const confidence = Math.max(
            1,
            Math.min(99, Math.round((safety < 0 ? 50 : safety) + bias + (Math.random() * 10 - 5))),
          );
          const reasons: string[] = [];
          if (safety >= 0 && safety < s.safetyFilters.minSafety)
            reasons.push(`safety ${safety} < ${s.safetyFilters.minSafety}`);
          if (safety < 0) reasons.push("safety not yet scored");
          if (liquiditySol < s.safetyFilters.minLiquiditySol)
            reasons.push(
              `liquidity ${liquiditySol.toFixed(1)} < ${s.safetyFilters.minLiquiditySol} SOL`,
            );
          if (s.guardrails.duplicateGuard && s.positions.some((p) => p.token === token))
            reasons.push("duplicate position");
          if (confidence < 55) reasons.push(`confidence ${confidence} too low`);

          const decision: Opportunity["decision"] = reasons.length ? "skip" : "enter";
          const opp: Opportunity = {
            id: id(),
            ts: Date.now(),
            token,
            mint,
            decimals,
            // Mirror mint into tokenAddress so checkLiveEntry (which accepts
            // either field) and the live executor both see a valid SPL mint
            // regardless of which feed produced this opportunity.
            tokenAddress: mint ?? null,
            venue,
            liquiditySol,
            safety,
            confidence,
            decision,
            reason: reasons.join(" · ") || `council bias ${bias >= 0 ? "+" : ""}${bias}`,
            symbol: token,
            // Expose the scored safety on the fields the live-entry gate and
            // the opportunity feed read, so a real safety_score (not the -1
            // "not yet checked" sentinel) drives eligibility.
            safetyScore: safety >= 0 ? safety : undefined,
            score: safety >= 0 ? safety : undefined,
          };
          newOpportunities.push(opp);
          feedLogs.push({
            id: id(),
            ts: Date.now(),
            type: decision === "enter" ? "strategy" : "safety",
            summary: `${decision === "enter" ? "ENTER" : "SKIP"} ${token} (${venue}) · safety ${safety} · conf ${confidence}${reasons.length ? ` · ${reasons[0]}` : ""}`,
          });

          // ---- 3. paper entry (live entries need a wallet signature) ---
          if (decision === "enter" && s.mode === "paper") {
            const cap = s.guardrails.adaptiveSizing
              ? bankroll * (0.05 + (confidence / 100) * 0.35)
              : Math.min(s.guardrails.maxPositionSol, bankroll * 0.25);
            // NOTE: previously floored at MIN_USER_DEPOSIT_SOL (0.1), which is
            // the *account* minimum deposit, not a per-trade minimum — that
            // silently blew through the maxPositionSol guardrail on small
            // bankrolls. Respect the guardrail cap; just require a non-dust size.
            const sizeSol = Math.min(cap, bankroll * 0.9);
            if (sizeSol <= bankroll && sizeSol > 0.001) {
              const price = 0.5 + Math.random() * 4;
              remaining.unshift({
                id: id(),
                token,
                mint,
                decimals,
                venue,
                entry: price,
                current: price,
                sizeSol,
                tp: price * 1.12,
                sl: price * 0.94,
                openedAt: Date.now(),
                agentSized: s.guardrails.adaptiveSizing,
              });
              bankroll = Math.max(0, bankroll - sizeSol);
              feedLogs.push({
                id: id(),
                ts: Date.now(),
                type: "execution",
                summary: `ENTRY ${token} · size ${sizeSol.toFixed(4)} SOL @ ${price.toFixed(4)}`,
              });
            }
          }
        }

        function applyTick(): void {
          const cur = get();
          const openTrades = closed.length;
          const cycleClosedTrades = [...closed, ...cur.cycleClosedTrades].slice(
            0,
            DEBRIEF_TRADE_WINDOW * 2,
          );
          const tradesSinceDebrief = cur.tradesSinceDebrief + openTrades;
          const skipsAdded = newOpportunities.filter((o) => o.decision === "skip").length;
          const entriesAdded = newOpportunities.filter((o) => o.decision === "enter").length;
          const nextBankroll = bankroll;
          const equityValue = nextBankroll + remaining.reduce((a, p) => a + p.sizeSol, 0);
          const peak = Math.max(cur.peakBankroll, equityValue);
          const drawdownPct = peak > 0 ? ((peak - equityValue) / peak) * 100 : 0;
          const dailyLossPct =
            cur.startBankroll > 0
              ? ((cur.startBankroll - equityValue) / cur.startBankroll) * 100
              : 0;
          const breached =
            drawdownPct >= cur.guardrails.drawdownLimitPct ||
            dailyLossPct >= cur.guardrails.dailyLossLimitPct;

          const councilLogs: DecisionLogEntry[] = [];
          let councilMemory = cur.councilMemory;
          let councilCycleId = cur.councilCycleId;
          let sinceDebrief = tradesSinceDebrief;
          if (sinceDebrief >= DEBRIEF_TRADE_WINDOW) {
            const debrief = buildDebrief({
              cycleId: councilCycleId,
              windowTrades: cycleClosedTrades.slice(0, DEBRIEF_TRADE_WINDOW),
            });
            councilMemory = [debrief, ...councilMemory].slice(0, MAX_COUNCIL_MEMORY);
            cur.onCouncilAppend?.(debrief);
            councilLogs.push({
              id: id(),
              ts: Date.now(),
              type: "learning",
              summary: `COUNCIL_DEBRIEF ${councilCycleId} · ${debrief.summary}`,
            });
            councilCycleId = `cyc_${Math.random().toString(36).slice(2, 10)}`;
            sinceDebrief = 0;
          }

          set({
            positions: remaining.slice(0, MAX_HISTORY),
            opportunities: [...newOpportunities, ...cur.opportunities].slice(0, MAX_FEED),
            bankroll: nextBankroll,
            walletBalanceSol,
            peakBankroll: peak,
            sessionPnl: equityValue - cur.startBankroll,
            totalFeesPaidSol: cur.totalFeesPaidSol + fees,
            tradesToday: cur.tradesToday + entriesAdded,
            skipsToday: cur.skipsToday + skipsAdded,
            tradeHistory: [...closed, ...cur.tradeHistory].slice(0, MAX_HISTORY),
            equity: [...cur.equity, { ts: Date.now(), value: equityValue }].slice(-MAX_EQUITY),
            cycleClosedTrades,
            cyclePnlDelta: cur.cyclePnlDelta + closed.reduce((a, t) => a + t.netToUserSol, 0),
            tradesSinceDebrief: sinceDebrief,
            councilMemory,
            councilCycleId,
            guardrailBreached: breached,
            status: breached ? "paused" : cur.status,
            log: prepend(
              cur.log,
              ...exitLogs,
              ...feedLogs,
              ...councilLogs,
              ...(breached
                ? [
                    {
                      id: id(),
                      ts: Date.now(),
                      type: "error" as const,
                      summary: `GUARDRAIL_BREACH · drawdown ${drawdownPct.toFixed(2)}% · daily loss ${dailyLossPct.toFixed(2)}%`,
                    },
                  ]
                : []),
            ).slice(0, MAX_LOG),
          });
        }

        applyTick();
      },
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
      setDiscoveryCandidates: (rows) => set({ discoveryCandidates: rows }),
      checkLiveEntry: (opportunityId: string) => {
        const s = get();
        const opportunity = s.opportunities.find((o) => o.id === opportunityId);
        if (!opportunity)
          return { ok: false as const, error: `Opportunity not found: ${opportunityId}` };
        if (s.mode !== "live" || s.status !== "running")
          return { ok: false as const, error: "Live mode not running" };
        if (!s.walletConnected || !s.walletAddress)
          return { ok: false as const, error: "Wallet not connected" };
        if (s.guardrailBreached) return { ok: false as const, error: "Guardrail breached" };
        if (s.positions.some((p) => p.token === opportunity.token && p.live))
          return { ok: false as const, error: "Duplicate live position" };
        const minSize = Math.max(0.001, Math.min(s.bankroll * 0.1, s.guardrails.maxPositionSol));
        if (!Number.isFinite(minSize) || minSize <= 0 || minSize > s.bankroll)
          return {
            ok: false as const,
            error: `Insufficient bankroll (${s.bankroll.toFixed(5)} SOL)`,
          };
        const score = opportunity.safetyScore ?? opportunity.score ?? opportunity.safety ?? 0;
        if (score < s.safetyFilters.minSafety)
          return {
            ok: false as const,
            error: `Safety threshold failed (${score} < ${s.safetyFilters.minSafety})`,
          };
        // Live entries require a real on-chain SPL mint to swap against.
        // Both `mint` (set by the discovery-candidate → opportunity path in
        // tick()) and `tokenAddress` (set by pushRealOpportunity from the
        // DexScreener stream) are valid sources — accept either so live
        // trading isn't gated on a field only one feed populates.
        const tokenAddress =
          opportunity.mint ??
          (opportunity as Opportunity & { tokenAddress?: string | null }).tokenAddress ??
          null;
        if (!tokenAddress) return { ok: false as const, error: "Mint validation failed" };
        return { ok: true as const, sizeSol: minSize };
      },
      // NOTE: this is the ONLY variant that writes to the store (logs
      // ENTRY_REQUESTED). It must only be called from an event handler
      // (e.g. the Execute button's onClick) — never from a component's
      // render body. Calling a `set()`-triggering action during render is
      // a React anti-pattern: it either throws "Cannot update a component
      // while rendering a different component", or — since a successful
      // gate here changes state, which re-renders the button, which (if
      // this were called again during render) would re-trigger the same
      // check — spams the log and can runaway into infinite re-renders.
      // Use checkLiveEntry (pure, no side effects) for render-time gating.
      requestLiveEntry: (opportunityId: string) => {
        const s = get();
        const gate = s.checkLiveEntry(opportunityId);
        const opportunity = s.opportunities.find((o) => o.id === opportunityId);
        if (!gate.ok) {
          set((cur) => guardrailReject(cur, gate.error, opportunityId, opportunity?.symbol));
          return gate;
        }
        set((cur) => ({
          log: prepend(cur.log, {
            id: id(),
            ts: Date.now(),
            type: "execution",
            summary: `ENTRY_REQUESTED · ${opportunity!.symbol} · size ${gate.sizeSol.toFixed(5)} SOL · score ${opportunity!.safetyScore ?? opportunity!.score ?? opportunity!.safety ?? 0}`,
          }).slice(0, MAX_LOG),
        }));
        return gate;
      },
      confirmLiveEntry: ({ opportunityId, sizeSol, signature }) => {
        const s = get();
        const opp = s.opportunities.find((o) => o.id === opportunityId);
        if (!opp) return;
        // Accept either field as the SPL mint (both feeds are valid sources).
        const tokenAddress =
          opp.mint ?? (opp as Opportunity & { tokenAddress?: string | null }).tokenAddress ?? null;
        const positionId = id();
        const position: Position = {
          id: positionId,
          token: opp.token,
          mint: opp.mint ?? tokenAddress ?? undefined,
          decimals: opp.decimals,
          venue: opp.venue,
          sizeSol,
          // Use a real price if the opportunity carries one; otherwise fall
          // back to 1.0 so downstream pnl math never divides by zero. Live
          // positions are NOT random-walked by tick() (see B5 guard), so this
          // is only a notional reference until a real exit is executed.
          entry: opp.entryPrice ?? opp.price ?? 1,
          current: opp.entryPrice ?? opp.price ?? 1,
          live: true,
          tp: 0,
          sl: 0,
          mintAddress: tokenAddress ?? null,
          entrySignature: signature,
          openedAt: Date.now(),
        } as Position;
        set((cur) => ({
          positions: [position, ...cur.positions].slice(0, MAX_HISTORY),
          bankroll: Math.max(0, cur.bankroll - sizeSol),
          walletBalanceSol:
            cur.walletBalanceSol == null ? null : Math.max(0, cur.walletBalanceSol - sizeSol),
          tradesToday: cur.tradesToday + 1,
          log: prepend(cur.log, {
            id: id(),
            ts: Date.now(),
            type: "execution",
            summary: `ENTRY_EXECUTED · ${opp.symbol} · size ${sizeSol.toFixed(5)} SOL · sig ${signature.slice(0, 8)}…`,
          }).slice(0, MAX_LOG),
        }));
      },
      failLiveEntry: ({ opportunityId, reason }) =>
        set((cur) => ({
          skipsToday: cur.skipsToday + 1,
          log: prepend(cur.log, {
            id: id(),
            ts: Date.now(),
            type: "error",
            summary: `ENTRY_FAILED · ${opportunityId} · ${reason}`,
          }).slice(0, MAX_LOG),
        })),
      pushRealOpportunity: ({ token, venue, symbol, liquiditySol, tokenAddress }) => {
        const s = get();
        if (!s.activeVenues[venue]) return null;
        if (!Number.isFinite(liquiditySol) || liquiditySol <= 0) return null;
        const oppId = id();
        const score = Math.min(99, Math.max(1, Math.floor(50 + liquiditySol / 10)));
        // CRITICAL: write BOTH `mint` (canonical SPL mint used by the swap
        // path and the LiveExecuteButton's `!opp.mint` render gate) AND
        // `tokenAddress` (read by checkLiveEntry/confirmLiveEntry). Previously
        // `tokenAddress` was accepted as a parameter but silently dropped,
        // and `mint` was never set — so the Execute button never rendered
        // and checkLiveEntry always failed with "Mint validation failed",
        // structurally blocking every live entry.
        const opportunity: Opportunity = {
          id: oppId,
          ts: Date.now(),
          token,
          symbol,
          venue,
          liquiditySol,
          score,
          safety: -1,
          confidence: score,
          decision: "skip",
          live: s.mode === "live",
          mint: tokenAddress ?? undefined,
          tokenAddress: tokenAddress ?? null,
        };
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
      applySafetyVerdict: ({ opportunityId, score, verdict }) =>
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
        })),
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
    { name: "snipe-master-bot", storage: createJSONStorage(() => localStorage) },
  ),
);
