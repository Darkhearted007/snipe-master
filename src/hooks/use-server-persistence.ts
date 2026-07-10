import { useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useBotStore } from "@/lib/bot-store";
import {
  loadUserState,
  saveUserSettings,
  appendDecisionLogs,
  appendTradeHistory,
  saveWatchlist,
  type LoadedState,
} from "@/lib/persistence.functions";
import { logStructured } from "@/lib/structured-logger";

const SETTINGS_KEYS = [
  "mode",
  "liveConfirmed",
  "userDeposit",
  "platformFeePct",
  "guardrails",
  "safetyFilters",
  "activeVenues",
  "autoCurate",
] as const;

/** Bidirectional sync between the bot store and Lovable Cloud.
 *  Hydrates once on mount; debounces settings/watchlist writes; flushes new
 *  log entries and trade rows on a timer. All writes are best-effort — a
 *  server failure logs an error but never blocks the trading loop. */
export function useServerPersistence(enabled: boolean) {
  const load = useServerFn(loadUserState);
  const saveSettings = useServerFn(saveUserSettings);
  const flushLogs = useServerFn(appendDecisionLogs);
  const flushTrade = useServerFn(appendTradeHistory);
  const flushWatch = useServerFn(saveWatchlist);
  const hydrated = useRef(false);
  const lastLogId = useRef<string | null>(null);
  const lastTradeId = useRef<string | null>(null);
  const settingsTimer = useRef<number | null>(null);
  const watchTimer = useRef<number | null>(null);

  // 1) Hydrate once
  useEffect(() => {
    if (!enabled || hydrated.current) return;
    hydrated.current = true;
    (async () => {
      try {
        const payload = (await load()) as LoadedState;
        useBotStore.getState().hydrateFromServer({
          settings: payload.settings ? JSON.parse(payload.settings) : null,
          trades: JSON.parse(payload.trades),
          logs: JSON.parse(payload.logs),
          watchlist: JSON.parse(payload.watchlist),
        });
        const logs = JSON.parse(payload.logs) as Array<{ id: string }>;
        const trades = JSON.parse(payload.trades) as Array<{ id: string }>;
        lastLogId.current = logs[0]?.id ?? null;
        lastTradeId.current = trades[0]?.id ?? null;
      } catch (e) {
        logStructured(e, { category: "persistence", context: { op: "hydrate" } });
      }
    })();
  }, [enabled, load]);

  // 2) Settings write (debounced)
  useEffect(() => {
    if (!enabled) return;
    const unsub = useBotStore.subscribe((s) => {
      if (settingsTimer.current) window.clearTimeout(settingsTimer.current);
      const snap: Record<string, unknown> = {};
      for (const k of SETTINGS_KEYS) snap[k] = (s as unknown as Record<string, unknown>)[k];
      settingsTimer.current = window.setTimeout(() => {
        saveSettings({ data: { settingsJson: JSON.stringify(snap) } }).catch((e) =>
          logStructured(e, { category: "persistence", context: { op: "settings save" } }),
        );
      }, 800) as unknown as number;
    });
    return () => {
      unsub();
      if (settingsTimer.current) window.clearTimeout(settingsTimer.current);
    };
  }, [enabled, saveSettings]);

  // 3) Watchlist write (debounced)
  useEffect(() => {
    if (!enabled) return;
    const unsub = useBotStore.subscribe((s) => {
      if (watchTimer.current) window.clearTimeout(watchTimer.current);
      const entries = s.watchlist.map((w) => ({
        symbol: w.symbol,
        venue: w.venue,
        source: w.source,
        enabled: w.enabled,
        safety: w.safety,
        liquidity_sol: w.liquiditySol,
        positive_streak: w.positiveStreak,
        note: w.note ?? null,
        added_at: w.addedAt,
      }));
      watchTimer.current = window.setTimeout(() => {
        flushWatch({ data: { entries } }).catch((e) =>
          logStructured(e, { category: "persistence", context: { op: "watchlist save" } }),
        );
      }, 1500) as unknown as number;
    });
    return () => {
      unsub();
      if (watchTimer.current) window.clearTimeout(watchTimer.current);
    };
  }, [enabled, flushWatch]);

  // 4) Log + trade flush (batched every 3s)
  useEffect(() => {
    if (!enabled) return;
    const iv = window.setInterval(async () => {
      const s = useBotStore.getState();
      // logs — take everything newer than lastLogId
      const newLogs: typeof s.log = [];
      for (const l of s.log) {
        if (l.id === lastLogId.current) break;
        newLogs.push(l);
      }
      if (newLogs.length) {
        try {
          await flushLogs({
            data: {
              entries: newLogs.slice(0, 100).map((l) => ({
                ts: l.ts,
                type: l.type,
                summary: l.summary,
              })),
            },
          });
          lastLogId.current = s.log[0]?.id ?? lastLogId.current;
        } catch {
          /* ignore — next tick will retry */
        }
      }
      // trades — insert one-at-a-time (typically low volume)
      const newTrades: typeof s.tradeHistory = [];
      for (const t of s.tradeHistory) {
        if (t.id === lastTradeId.current) break;
        newTrades.push(t);
      }
      for (const t of newTrades.reverse()) {
        try {
          await flushTrade({
            data: {
              ts: t.ts,
              mode: t.mode,
              token: t.token,
              venue: t.venue,
              size_sol: t.sizeSol,
              entry: t.entry,
              exit: t.exit,
              pnl_sol: t.pnlSol,
              reason: t.reason,
              fee_paid_sol: t.feePaidSol,
              net_to_user_sol: t.netToUserSol,
              fee_wallet: t.feeWallet ?? null,
            },
          });
        } catch {
          /* ignore individual failures */
        }
      }
      lastTradeId.current = s.tradeHistory[0]?.id ?? lastTradeId.current;
    }, 3_000);
    return () => window.clearInterval(iv);
  }, [enabled, flushLogs, flushTrade]);
}
