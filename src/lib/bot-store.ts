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
} from "./bot-types";
import { MIN_USER_DEPOSIT_SOL, PLATFORM_FEE_WALLET } from "./bot-types";

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

  tick: () => void;
  healthCheck: () => void;

  setDiscoveryCandidates: (rows: DiscoveryCandidate[]) => void;
  // Guardrail/permission check the UI calls BEFORE opening a wallet popup.
  // Does not touch bankroll or positions — that only happens after a real
  // swap is confirmed on-chain, via confirmLiveEntry.
  requestLiveEntry: (
    opportunityId: string,
  ) => { ok: true; sizeSol: number } | { ok: false; error: string };
  confirmLiveEntry: (input: { opportunityId: string; sizeSol: number; signature: string }) => void;
  failLiveEntry: (input: { opportunityId: string; reason: string }) => void;
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
};

export const useBotStore = create<BotState>()(
  persist(
    (set, get) => ({
      ...initial,

      setMode: (mode) =>
        set((s) => ({
          // Resilience rule: switching modes never stops a running bot.
          // Only the Stop button transitions to "idle".
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
          // Simulated wallet handshake (Phantom/Backpack-style).
          // A real integration would call window.solana.connect() here.
          await new Promise((r) => setTimeout(r, 600));
          const addr = mockAddress();
          set((cur) => ({
            walletConnecting: false,
            walletConnected: true,
            walletAddress: addr,
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
          // Resilience: disconnecting the wallet in live mode no longer
          // hard-stops the bot — only the Stop button does that. Live mode
          // will refuse to place *new* orders without a wallet.
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
      // Explicit, separate from stop(): stop() must NEVER silently clear a
      // guardrail breach or wipe P&L history. Starting a fresh session is a
      // deliberate user action with its own audit log line.
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
          };
          return {
            positions: s.positions.filter((x) => x.id !== pid),
            bankroll,
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

      addWatch: ({ symbol, venue, note }) => {
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
        // Self-heal: recover from stuck "error" state or paused-with-ack
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

      requestLiveEntry: (opportunityId) => {
        const s = get();
        const opp = s.opportunities.find((o) => o.id === opportunityId);
        if (!opp) return { ok: false, error: "Opportunity not found" };
        if (s.mode !== "live") return { ok: false, error: "Not in live mode" };
        if (s.guardrailBreached)
          return { ok: false, error: "Guardrail breach active — resolve before trading" };
        if (!s.walletConnected) return { ok: false, error: "Wallet not connected" };
        if (!opp.mint) return { ok: false, error: "No mint address on this opportunity" };
        if (opp.safety == null || opp.safety < s.safetyFilters.minSafety) {
          return { ok: false, error: "Safety score missing or below threshold" };
        }
        if (s.guardrails.duplicateGuard && s.positions.some((p) => p.mint === opp.mint)) {
          return { ok: false, error: "Already holding a position in this mint" };
        }
        const bankrollForSize = Math.max(0, s.bankroll);
        if (bankrollForSize < 0.001) return { ok: false, error: "Bankroll too low" };
        const sizeSol = s.guardrails.adaptiveSizing
          ? Math.min(bankrollForSize * 0.2, bankrollForSize * 0.5)
          : Math.min(s.guardrails.maxPositionSol, bankrollForSize * 0.5);
        if (sizeSol <= 0) return { ok: false, error: "Computed size is zero" };
        return { ok: true, sizeSol };
      },

      // Called only after a real swap has been signed, sent, AND confirmed
      // on-chain (see useLiveExecution). Bankroll only ever moves here for
      // live trades — tick() never touches it in live mode.
      confirmLiveEntry: ({ opportunityId, sizeSol, signature }) =>
        set((s) => {
          const opp = s.opportunities.find((o) => o.id === opportunityId);
          if (!opp || !opp.mint) return {};
          const position: Position = {
            id: id(),
            token: opp.token,
            mint: opp.mint,
            decimals: opp.decimals,
            venue: opp.venue,
            entry: 1,
            current: 1,
            sizeSol,
            tp: 1.35,
            sl: 0.85,
            openedAt: Date.now(),
            live: true,
            entrySignature: signature,
          };
          const bankroll = Math.max(0, s.bankroll - sizeSol);
          return {
            bankroll,
            positions: [...s.positions, position],
            tradesToday: s.tradesToday + 1,
            log: prepend(s.log, {
              id: id(),
              ts: Date.now(),
              type: "execution",
              summary: `LIVE fill · ${opp.token} · ${sizeSol.toFixed(5)} SOL · sig ${shortAddr(signature)}`,
            }).slice(0, MAX_LOG),
          };
        }),

      failLiveEntry: ({ opportunityId, reason }) =>
        set((s) => {
          const opp = s.opportunities.find((o) => o.id === opportunityId);
          return {
            log: prepend(s.log, {
              id: id(),
              ts: Date.now(),
              type: "error",
              summary: `LIVE entry failed · ${opp?.token ?? opportunityId} · ${reason}`,
            }).slice(0, MAX_LOG),
          };
        }),

      tick: () => {
        try {
          const s = get();
          if (s.status !== "running") return;

          const active = (Object.keys(s.activeVenues) as Venue[]).filter((v) => s.activeVenues[v]);
          if (active.length === 0) return;

          let bankroll = s.bankroll;
          // Live positions are real, on-chain fills — they must NEVER get
          // synthetic price drift or a fake auto-close. Until real price
          // polling + real sell-swap exits are wired (tracked separately),
          // live positions just pass through untouched each tick; closing
          // them is a manual action that will route through a real swap.
          const positions = s.positions.map((p) => {
            if (p.live) return p;
            const drift = (Math.random() - 0.48) * 0.05;
            return { ...p, current: Math.max(0.0000001, p.current * (1 + drift)) };
          });

          const keptPositions: Position[] = [];
          const newLogs: DecisionLogEntry[] = [];
          const newHistory: TradeHistoryEntry[] = [];
          let feesAccrued = 0;

          for (const p of positions) {
            if (p.live) {
              keptPositions.push(p);
              continue;
            }
            const rr = p.current / p.entry;
            if (rr >= p.tp || rr <= p.sl) {
              const pnl = (p.current - p.entry) * (p.sizeSol / p.entry);
              const fee = s.mode === "live" && pnl > 0 ? pnl * (s.platformFeePct / 100) : 0;
              const net = pnl - fee;
              bankroll += p.sizeSol + net;
              feesAccrued += fee;
              const reason: TradeHistoryEntry["reason"] = rr >= p.tp ? "tp" : "sl";
              newHistory.push({
                id: id(),
                ts: Date.now(),
                mode: s.mode,
                token: p.token,
                venue: p.venue,
                sizeSol: p.sizeSol,
                entry: p.entry,
                exit: p.current,
                pnlSol: pnl,
                reason,
                feePaidSol: fee,
                netToUserSol: net,
                feeWallet: fee > 0 ? s.platformFeeWallet : undefined,
              });
              newLogs.push({
                id: id(),
                ts: Date.now(),
                type: "execution",
                summary: `Exit ${p.token} @ ${reason.toUpperCase()} · ${pnl >= 0 ? "+" : ""}${pnl.toFixed(5)} SOL${fee > 0 ? ` · fee ${fee.toFixed(5)}` : ""}`,
              });
              if (fee > 0) {
                newLogs.push({
                  id: id(),
                  ts: Date.now(),
                  type: "audit",
                  summary: `Fee ${fee.toFixed(5)} SOL routed → ${shortAddr(s.platformFeeWallet)}`,
                });
              }
              newLogs.push({
                id: id(),
                ts: Date.now(),
                type: "learning",
                summary: `Updated confidence weights for ${p.token} venue=${p.venue}`,
              });
            } else {
              keptPositions.push(p);
            }
          }

          const opportunities = [...s.opportunities];
          let watchlist = s.watchlist;
          const sf = s.safetyFilters;

          if (s.mode === "paper" && Math.random() < 0.75) {
            const token = rand(TOKENS) + Math.floor(Math.random() * 99);
            const venue = rand(active);
            const symbol = `${token}/SOL`;
            const liquidity = 2 + Math.random() * 80;
            const safety = Math.floor(30 + Math.random() * 70);
            const confidence = Math.floor(20 + Math.random() * 80);

            const failsSafety = safety < sf.minSafety || liquidity < sf.minLiquiditySol;
            const inWatchlist = watchlist.some(
              (w) => w.symbol === symbol && w.venue === venue && w.enabled,
            );

            const shouldEnter =
              !failsSafety &&
              confidence >= 55 &&
              keptPositions.length < 5 &&
              bankroll >= 0.001 &&
              !keptPositions.some((p) => p.token === token && s.guardrails.duplicateGuard);

            const reason = shouldEnter
              ? undefined
              : failsSafety
                ? safety < sf.minSafety
                  ? `safety<${sf.minSafety}`
                  : `liquidity<${sf.minLiquiditySol}`
                : confidence < 55
                  ? "low confidence"
                  : "risk cap";

            const opp: Opportunity = {
              id: id(),
              ts: Date.now(),
              token,
              venue,
              liquiditySol: liquidity,
              safety,
              confidence,
              decision: shouldEnter ? "enter" : "skip",
              reason,
            };
            opportunities.unshift(opp);
            if (opportunities.length > MAX_FEED) opportunities.length = MAX_FEED;

            newLogs.push({
              id: id(),
              ts: Date.now(),
              type: "feed",
              summary: `${token} discovered on ${venue} · liq ${liquidity.toFixed(1)} SOL`,
            });
            newLogs.push({
              id: id(),
              ts: Date.now(),
              type: "safety",
              summary: failsSafety
                ? `${token} FILTERED · ${reason}`
                : `${token} safety ${safety}/100`,
            });
            newLogs.push({
              id: id(),
              ts: Date.now(),
              type: "strategy",
              summary: `${token} confidence ${confidence}% → ${opp.decision}`,
            });

            if (s.autoCurate && !failsSafety) {
              const existing = watchlist.find((w) => w.symbol === symbol && w.venue === venue);
              if (existing) {
                const nextStreak = shouldEnter ? existing.positiveStreak + 1 : 0;
                watchlist = watchlist.map((w) =>
                  w === existing
                    ? { ...w, positiveStreak: nextStreak, safety, liquiditySol: liquidity }
                    : w,
                );
                if (shouldEnter && nextStreak === 5) {
                  newLogs.push({
                    id: id(),
                    ts: Date.now(),
                    type: "audit",
                    summary: `Auto-curated ${symbol} reached promotion threshold`,
                  });
                }
              } else if (shouldEnter && watchlist.length < 40) {
                watchlist = [
                  {
                    id: id(),
                    symbol,
                    venue,
                    source: "auto",
                    enabled: true,
                    safety,
                    liquiditySol: liquidity,
                    positiveStreak: 1,
                    addedAt: Date.now(),
                  },
                  ...watchlist,
                ];
                newLogs.push({
                  id: id(),
                  ts: Date.now(),
                  type: "audit",
                  summary: `Auto-curated add · ${symbol} (candidate)`,
                });
              }
            }

            if (shouldEnter) {
              // Adaptive sizing: agent chooses size based on confidence & safety,
              // otherwise clamp to maxPositionSol. PAPER MODE ONLY — bankroll
              // is fake here. Live mode never reaches this branch; real fills
              // only ever happen via confirmLiveEntry after an on-chain confirm.
              const bankrollForSize = Math.max(0, bankroll);
              let size: number;
              let agentSized = false;
              if (s.guardrails.adaptiveSizing) {
                const conviction = (confidence / 100) * (safety / 100); // 0..1
                const frac = 0.05 + conviction * 0.35; // 5%–40% of bankroll
                size = Math.min(bankrollForSize * frac, bankrollForSize * 0.5);
                agentSized = true;
                newLogs.push({
                  id: id(),
                  ts: Date.now(),
                  type: "strategy",
                  summary: `Agent sized ${token} · ${(frac * 100).toFixed(1)}% bankroll (conf ${confidence}, safety ${safety})`,
                });
              } else {
                size = Math.min(s.guardrails.maxPositionSol, bankrollForSize * 0.5);
              }
              size = Math.max(0, Math.min(size, bankrollForSize));
              if (size > 0) {
                bankroll -= size;
                const entry = 1;
                keptPositions.push({
                  id: id(),
                  token,
                  venue,
                  entry,
                  current: entry,
                  sizeSol: size,
                  tp: 1.35 + Math.random() * 0.6,
                  sl: 0.75 + Math.random() * 0.1,
                  openedAt: Date.now(),
                  agentSized,
                });
                newLogs.push({
                  id: id(),
                  ts: Date.now(),
                  type: "execution",
                  summary: `Enter ${token} · size ${size.toFixed(5)} SOL${agentSized ? " (agent)" : ""}`,
                });
              }
            }
          } else if (s.mode === "live") {
            // Real candidates only, sourced from the Helius webhook via
            // setDiscoveryCandidates(). No synthetic tokens, no auto-fill —
            // this branch only ever surfaces opportunities for the UI to
            // present; actual entry requires requestLiveEntry() + a real
            // wallet-signed swap via useLiveExecution, then confirmLiveEntry().
            const known = new Set(opportunities.map((o) => o.mint).filter(Boolean));
            const candidate = s.discoveryCandidates.find((c) => !known.has(c.mint));
            if (candidate) {
              const venue = venueFromDiscovery(candidate.venue);
              const liquidity = (candidate.liquidity_usd ?? 0) / 150; // rough USD->SOL, real price feed TODO
              // safety_score is NULL until the safety pipeline (ported
              // separately from SolanaSafetyProvider) actually checks this
              // mint. NULL must never be treated as safe.
              const failsSafety =
                candidate.safety_score == null || candidate.safety_score < sf.minSafety;
              const reason = failsSafety
                ? candidate.safety_score == null
                  ? "awaiting safety check"
                  : `safety<${sf.minSafety}`
                : undefined;

              const opp: Opportunity = {
                id: id(),
                ts: Date.now(),
                token: candidate.symbol,
                mint: candidate.mint,
                decimals: candidate.decimals,
                venue,
                liquiditySol: liquidity,
                safety: candidate.safety_score ?? -1,
                confidence: 0, // no live confidence engine ported yet
                decision: failsSafety ? "skip" : "skip", // never auto-enter in live mode; see requestLiveEntry
                reason: reason ?? "manual review required",
              };
              opportunities.unshift(opp);
              if (opportunities.length > MAX_FEED) opportunities.length = MAX_FEED;
              newLogs.push({
                id: id(),
                ts: Date.now(),
                type: "feed",
                summary: `${opp.token} discovered on ${venue} (real, mint ${candidate.mint.slice(0, 4)}..${candidate.mint.slice(-4)})`,
              });
            }
          }

          const unrealized = keptPositions.reduce(
            (acc, p) => acc + (p.current - p.entry) * (p.sizeSol / p.entry) + p.sizeSol,
            0,
          );
          const equityNow = bankroll + unrealized;
          const equity = [...s.equity, { ts: Date.now(), value: equityNow }];
          if (equity.length > MAX_EQUITY) equity.shift();

          const peak = Math.max(s.peakBankroll, equityNow);
          const drawdownPct = ((peak - equityNow) / peak) * 100;
          const dailyLossPct = ((s.startBankroll - equityNow) / s.startBankroll) * 100;
          const breached =
            drawdownPct > s.guardrails.drawdownLimitPct ||
            dailyLossPct > s.guardrails.dailyLossLimitPct;

          const enters = newLogs.filter((l) => l.summary.startsWith("Enter ")).length;
          const skips = newLogs.filter(
            (l) => l.type === "strategy" && l.summary.endsWith("skip"),
          ).length;

          if (breached) {
            newLogs.push({
              id: id(),
              ts: Date.now(),
              type: "audit",
              summary: `Guardrail breach · dd=${drawdownPct.toFixed(2)}% dl=${dailyLossPct.toFixed(2)}%`,
            });
          }

          set({
            bankroll,
            positions: keptPositions,
            opportunities,
            watchlist,
            tradeHistory: [...newHistory, ...s.tradeHistory].slice(0, MAX_HISTORY),
            totalFeesPaidSol: s.totalFeesPaidSol + feesAccrued,
            log: prepend(s.log, ...newLogs).slice(0, MAX_LOG),
            equity,
            peakBankroll: peak,
            sessionPnl: equityNow - s.startBankroll,
            tradesToday: s.tradesToday + enters,
            skipsToday: s.skipsToday + skips,
            status: breached ? "paused" : "running",
            guardrailBreached: breached || s.guardrailBreached,
            healthTickErrors: 0,
          });
        } catch (err) {
          // Resilience rule: transient tick failures NEVER change status.
          // Only the Stop button transitions the bot to idle.
          const s = get();
          const errors = s.healthTickErrors + 1;
          const msg = err instanceof Error ? err.message : String(err);
          console.error("[bot-store] tick error", err);
          set({
            healthTickErrors: errors,
            log: prepend(s.log, {
              id: id(),
              ts: Date.now(),
              type: "error",
              summary: `Tick error (recovered, ${errors} total): ${msg}`,
            }).slice(0, MAX_LOG),
          });
        }
      },
    }),
    {
      name: "sniperbot-state-v2",
      storage: createJSONStorage(() =>
        typeof window !== "undefined"
          ? window.localStorage
          : ({
              getItem: () => null,
              setItem: () => undefined,
              removeItem: () => undefined,
              length: 0,
              clear: () => undefined,
              key: () => null,
            } satisfies Storage),
      ),
      // persist only the durable slices (wallet state comes from adapter)
      partialize: (s) => ({
        mode: s.mode,
        liveConfirmed: s.liveConfirmed,
        userDeposit: s.userDeposit,
        bankroll: s.bankroll,
        startBankroll: s.startBankroll,
        peakBankroll: s.peakBankroll,
        platformFeePct: s.platformFeePct,
        platformFeeWallet: s.platformFeeWallet,
        totalFeesPaidSol: s.totalFeesPaidSol,
        guardrails: s.guardrails,
        activeVenues: s.activeVenues,
        watchlist: s.watchlist,
        autoCurate: s.autoCurate,
        safetyFilters: s.safetyFilters,
        log: s.log,
        tradeHistory: s.tradeHistory,
      }),
      version: 3,

      onRehydrateStorage: () => (state) => {
        // Never restore "running" — always start idle so the simulator does not
        // auto-resume without a user click.
        if (state) {
          state.status = "idle";
          state.startedAt = null;
        }
      },
    },
  ),
);
