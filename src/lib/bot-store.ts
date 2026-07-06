import { create } from "zustand";
import type {
  BotMode,
  BotStatus,
  DecisionLogEntry,
  EquityPoint,
  Guardrails,
  Opportunity,
  Position,
  SafetyFilters,
  Venue,
  WatchEntry,
} from "./bot-types";

const STARTING_BANKROLL = 0.1;
const MAX_FEED = 40;
const MAX_LOG = 80;
const MAX_EQUITY = 120;

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
const VENUES: Venue[] = ["raydium", "pumpfun", "bsc"];

function rand<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function id() {
  return Math.random().toString(36).slice(2, 10);
}

interface BotState {
  mode: BotMode;
  status: BotStatus;
  startedAt: number | null;
  liveConfirmed: boolean;
  walletConnected: boolean;

  bankroll: number;
  startBankroll: number;
  peakBankroll: number;
  sessionPnl: number;
  tradesToday: number;
  skipsToday: number;

  equity: EquityPoint[];
  guardrails: Guardrails;
  guardrailBreached: boolean;

  opportunities: Opportunity[];
  positions: Position[];
  log: DecisionLogEntry[];

  activeVenues: Record<Venue, boolean>;

  watchlist: WatchEntry[];
  autoCurate: boolean;
  safetyFilters: SafetyFilters;

  setMode: (m: BotMode) => void;
  confirmLive: () => void;
  toggleWallet: () => void;
  start: () => void;
  stop: () => void;
  killSwitch: () => void;
  acknowledgeBreach: () => void;
  closePosition: (id: string) => void;
  toggleVenue: (v: Venue) => void;
  setGuardrails: (g: Partial<Guardrails>) => void;

  addWatch: (input: { symbol: string; venue: Venue; note?: string }) =>
    | { ok: true }
    | { ok: false; error: string };
  removeWatch: (id: string) => void;
  toggleWatch: (id: string) => void;
  promoteAuto: (id: string) => void;
  clearAuto: () => void;
  setAutoCurate: (v: boolean) => void;
  setSafetyFilters: (f: Partial<SafetyFilters>) => void;

  tick: () => void;
}

export const useBotStore = create<BotState>((set, get) => ({
  mode: "paper",
  status: "idle",
  startedAt: null,
  liveConfirmed: false,
  walletConnected: false,

  bankroll: STARTING_BANKROLL,
  startBankroll: STARTING_BANKROLL,
  peakBankroll: STARTING_BANKROLL,
  sessionPnl: 0,
  tradesToday: 0,
  skipsToday: 0,

  equity: [{ ts: Date.now(), value: STARTING_BANKROLL }],
  guardrails: {
    maxPositionSol: 0.02,
    dailyLossLimitPct: 20,
    drawdownLimitPct: 15,
    duplicateGuard: true,
  },
  guardrailBreached: false,

  opportunities: [],
  positions: [],
  log: [],

  activeVenues: { raydium: true, pumpfun: true, bsc: false },

  autoCurate: true,
  safetyFilters: {
    minSafety: 60,
    minLiquiditySol: 5,
    requireLpLocked: true,
    blockHoneypots: true,
    maxHolderConcentrationPct: 25,
  },
  watchlist: [
    {
      id: id(),
      symbol: "SOL/USDC",
      venue: "raydium",
      source: "manual",
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
      venue: "raydium",
      source: "manual",
      enabled: true,
      safety: 82,
      liquiditySol: 380,
      positiveStreak: 0,
      addedAt: Date.now(),
    },
  ],

  setMode: (mode) =>
    set((s) => ({
      mode,
      status: s.status === "running" ? "idle" : s.status,
      startedAt: null,
    })),
  confirmLive: () => set({ liveConfirmed: true }),
  toggleWallet: () => set((s) => ({ walletConnected: !s.walletConnected })),

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
        summary: `Bot started in ${s.mode.toUpperCase()} mode`,
      }),
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
      }),
    })),
  killSwitch: () =>
    set((s) => ({
      status: "idle",
      positions: [],
      log: prepend(s.log, {
        id: id(),
        ts: Date.now(),
        type: "execution",
        summary: "KILL SWITCH — all positions flattened",
      }),
    })),
  acknowledgeBreach: () => set({ guardrailBreached: false }),
  closePosition: (pid) =>
    set((s) => {
      const p = s.positions.find((x) => x.id === pid);
      if (!p) return {};
      const pnl = (p.current - p.entry) * (p.sizeSol / p.entry);
      const bankroll = s.bankroll + p.sizeSol + pnl;
      return {
        positions: s.positions.filter((x) => x.id !== pid),
        bankroll,
        sessionPnl: bankroll - s.startBankroll,
        peakBankroll: Math.max(s.peakBankroll, bankroll),
        log: prepend(s.log, {
          id: id(),
          ts: Date.now(),
          type: "execution",
          summary: `Manual close ${p.token} · pnl ${pnl >= 0 ? "+" : ""}${pnl.toFixed(5)} SOL`,
        }),
      };
    }),
  toggleVenue: (v) =>
    set((s) => ({ activeVenues: { ...s.activeVenues, [v]: !s.activeVenues[v] } })),
  setGuardrails: (g) => set((s) => ({ guardrails: { ...s.guardrails, ...g } })),

  addWatch: ({ symbol, venue, note }) => {
    const s = get();
    const clean = symbol.trim().toUpperCase();
    if (!/^[A-Z0-9]+\/[A-Z0-9]+$/.test(clean)) {
      return { ok: false as const, error: "Use TOKEN/QUOTE format (e.g. BONK/SOL)" };
    }
    if (s.watchlist.some((w) => w.symbol === clean && w.venue === venue)) {
      return { ok: false as const, error: "Already in watchlist" };
    }
    const safety = Math.floor(55 + Math.random() * 45);
    const liq = 10 + Math.random() * 400;
    if (safety < s.safetyFilters.minSafety) {
      return {
        ok: false as const,
        error: `Failed safety filter (${safety} < ${s.safetyFilters.minSafety})`,
      };
    }
    if (liq < s.safetyFilters.minLiquiditySol) {
      return {
        ok: false as const,
        error: `Insufficient liquidity (${liq.toFixed(1)} SOL)`,
      };
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
      log: prepend(s.log, {
        id: id(),
        ts: Date.now(),
        type: "safety",
        summary: `Manual add ${clean} @ ${venue} · safety ${safety}/100`,
      }),
    });
    return { ok: true as const };
  },
  removeWatch: (wid) =>
    set((s) => ({ watchlist: s.watchlist.filter((w) => w.id !== wid) })),
  toggleWatch: (wid) =>
    set((s) => ({
      watchlist: s.watchlist.map((w) =>
        w.id === wid ? { ...w, enabled: !w.enabled } : w,
      ),
    })),
  promoteAuto: (wid) =>
    set((s) => ({
      watchlist: s.watchlist.map((w) =>
        w.id === wid ? { ...w, source: "manual" } : w,
      ),
    })),
  clearAuto: () =>
    set((s) => ({ watchlist: s.watchlist.filter((w) => w.source !== "auto") })),
  setAutoCurate: (v) => set({ autoCurate: v }),
  setSafetyFilters: (f) =>
    set((s) => ({ safetyFilters: { ...s.safetyFilters, ...f } })),


  tick: () => {
    const s = get();
    if (s.status !== "running") return;

    const active = (Object.keys(s.activeVenues) as Venue[]).filter((v) => s.activeVenues[v]);
    if (active.length === 0) return;

    // Update existing positions
    let bankroll = s.bankroll;
    const positions = s.positions.map((p) => {
      const drift = (Math.random() - 0.48) * 0.05;
      return { ...p, current: Math.max(0.0000001, p.current * (1 + drift)) };
    });

    // Auto exits on TP/SL
    const keptPositions: Position[] = [];
    const newLogs: DecisionLogEntry[] = [];
    for (const p of positions) {
      const rr = p.current / p.entry;
      if (rr >= p.tp || rr <= p.sl) {
        const pnl = (p.current - p.entry) * (p.sizeSol / p.entry);
        bankroll += p.sizeSol + pnl;
        newLogs.push({
          id: id(),
          ts: Date.now(),
          type: "execution",
          summary: `Exit ${p.token} @ ${rr >= p.tp ? "TP" : "SL"} · ${pnl >= 0 ? "+" : ""}${pnl.toFixed(5)} SOL`,
        });
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

    // Maybe generate an opportunity
    const opportunities = [...s.opportunities];
    let watchlist = s.watchlist;
    const sf = s.safetyFilters;

    if (Math.random() < 0.75) {
      const token = rand(TOKENS) + Math.floor(Math.random() * 99);
      const venue = rand(active);
      const symbol = `${token}/SOL`;
      const liquidity = 2 + Math.random() * 80;
      const safety = Math.floor(30 + Math.random() * 70);
      const confidence = Math.floor(20 + Math.random() * 80);

      // Safety filter gate
      const failsSafety =
        safety < sf.minSafety || liquidity < sf.minLiquiditySol;

      // In LIVE mode, executor may only trade tokens on enabled watchlist entries
      const inWatchlist = watchlist.some(
        (w) => w.symbol === symbol && w.venue === venue && w.enabled,
      );
      const liveGated = s.mode === "live" && !inWatchlist;

      const shouldEnter =
        !failsSafety &&
        !liveGated &&
        confidence >= 55 &&
        keptPositions.length < 5 &&
        bankroll >= s.guardrails.maxPositionSol &&
        !keptPositions.some((p) => p.token === token && s.guardrails.duplicateGuard);

      const reason = shouldEnter
        ? undefined
        : failsSafety
          ? safety < sf.minSafety
            ? `safety<${sf.minSafety}`
            : `liquidity<${sf.minLiquiditySol}`
          : liveGated
            ? "not in watchlist"
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

      // Automated watchlist curation: track streaks on eligible tokens
      if (s.autoCurate && !failsSafety) {
        const existing = watchlist.find(
          (w) => w.symbol === symbol && w.venue === venue,
        );
        if (existing) {
          watchlist = watchlist.map((w) =>
            w === existing
              ? {
                  ...w,
                  positiveStreak: shouldEnter ? w.positiveStreak + 1 : 0,
                  safety,
                  liquiditySol: liquidity,
                }
              : w,
          );
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
            type: "learning",
            summary: `Auto-added ${symbol} to watchlist (candidate)`,
          });
        }
      }

      if (shouldEnter) {
        const size = Math.min(s.guardrails.maxPositionSol, bankroll * 0.5);
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
        });
        newLogs.push({
          id: id(),
          ts: Date.now(),
          type: "execution",
          summary: `Enter ${token} · size ${size.toFixed(5)} SOL`,
        });
      }
    }


    // Compute equity including unrealized
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

    set({
      bankroll,
      positions: keptPositions,
      opportunities,
      log: prepend(s.log, ...newLogs).slice(0, MAX_LOG),
      equity,
      peakBankroll: peak,
      sessionPnl: equityNow - s.startBankroll,
      tradesToday: s.tradesToday + enters,
      skipsToday: s.skipsToday + skips,
      status: breached ? "paused" : "running",
      guardrailBreached: breached || s.guardrailBreached,
    });
  },
}));

function prepend<T>(arr: T[], ...items: T[]) {
  return [...items.reverse(), ...arr];
}
