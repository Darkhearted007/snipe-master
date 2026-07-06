import { create } from "zustand";
import type {
  BotMode,
  BotStatus,
  DecisionLogEntry,
  EquityPoint,
  Guardrails,
  Opportunity,
  Position,
  Venue,
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
    if (Math.random() < 0.75) {
      const token = rand(TOKENS) + Math.floor(Math.random() * 99);
      const venue = rand(active);
      const liquidity = 2 + Math.random() * 80;
      const safety = Math.floor(30 + Math.random() * 70);
      const confidence = Math.floor(20 + Math.random() * 80);
      const shouldEnter =
        safety >= 60 &&
        confidence >= 55 &&
        keptPositions.length < 5 &&
        bankroll >= s.guardrails.maxPositionSol &&
        !keptPositions.some((p) => p.token === token && s.guardrails.duplicateGuard);
      const opp: Opportunity = {
        id: id(),
        ts: Date.now(),
        token,
        venue,
        liquiditySol: liquidity,
        safety,
        confidence,
        decision: shouldEnter ? "enter" : "skip",
        reason: shouldEnter
          ? undefined
          : safety < 60
            ? "safety below 60"
            : confidence < 55
              ? "low confidence"
              : "risk cap",
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
        summary: `${token} safety ${safety}/100`,
      });
      newLogs.push({
        id: id(),
        ts: Date.now(),
        type: "strategy",
        summary: `${token} confidence ${confidence}% → ${opp.decision}`,
      });

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
