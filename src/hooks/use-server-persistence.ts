import { useEffect, useRef, useState } from "react";
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
import { retryWithBackoff, isPermanentError } from "@/lib/retry-backoff";
import { supabase } from "@/integrations/supabase/client";

/** Track Supabase session readiness so persistence writes never fire before a
 *  bearer token exists — eliminates the SIWS-flow 401 race. */
function useSessionReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setReady(!!data.session?.access_token);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setReady(!!session?.access_token);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);
  return ready;
}

async function hasSession(): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession();
    return !!data.session?.access_token;
  } catch {
    return false;
  }
}

/** Sentinel thrown when a persistence call is attempted without a session.
 *  Callers swallow it silently — it is the hard guard, not an error. */
class NoSessionError extends Error {
  constructor() {
    super("persistence skipped: no session");
    this.name = "NoSessionError";
  }
}
function isNoSession(e: unknown): boolean {
  return e instanceof NoSessionError;
}

/** Hard-guard wrapper: every persistence serverFn is routed through this.
 *  If there is no Supabase session at call time, the serverFn is never
 *  invoked. */
function guarded<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  return async (...args: A) => {
    if (!(await hasSession())) throw new NoSessionError();
    return fn(...args);
  };
}

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

/** Retry policy for all persistence writes: 5 attempts, 500ms→~16s with
 *  full jitter. Skips retry for auth/validation errors (401/403/422). */
function isUnauthorized(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /Unauthorized|401|No authorization header/i.test(msg);
}

function retryWrite<T>(op: () => Promise<T>, label: string) {
  return retryWithBackoff(op, {
    baseMs: 500,
    maxMs: 16_000,
    maxAttempts: 5,
    shouldRetry: (e) => !isPermanentError(e),
    onRetry: (attempt, delayMs, error) => {
      logStructured(error, {
        category: "persistence",
        severity: attempt >= 3 ? "warning" : "info",
        silent: attempt < 3,
        userMessage: attempt >= 3 ? `Cloud sync failing (${label}) — retrying` : undefined,
        context: { op: label, attempt, delayMs },
      });
    },
  });
}

/** Bidirectional sync between the bot store and Lovable Cloud.
 *  Hydrates once on mount; debounces settings/watchlist writes; flushes new
 *  log entries and trade rows on a timer. All writes retry with exponential
 *  backoff and never block the trading loop. */
export function useServerPersistence(enabledProp: boolean) {
  const sessionReady = useSessionReady();
  const enabled = enabledProp && sessionReady;

  const load = guarded(useServerFn(loadUserState));
  const saveSettings = guarded(useServerFn(saveUserSettings));
  const flushLogs = guarded(useServerFn(appendDecisionLogs));
  const flushTrade = guarded(useServerFn(appendTradeHistory));
  const flushWatch = guarded(useServerFn(saveWatchlist));
  const hydrated = useRef(false);
  const lastLogId = useRef<string | null>(null);
  const lastTradeId = useRef<string | null>(null);
  const settingsTimer = useRef<number | null>(null);
  const watchTimer = useRef<number | null>(null);

  // 1) Hydrate once (retried)
  useEffect(() => {
    if (!enabled || hydrated.current) return;
    hydrated.current = true;
    (async () => {
      if (!(await hasSession())) {
        hydrated.current = false;
        return;
      }
      try {
        const payload = (await retryWrite(() => load(), "hydrate")) as LoadedState;
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
        if (isUnauthorized(e) || isNoSession(e)) {
          hydrated.current = false;
          return;
        }
        logStructured(e, {
          category: "persistence",
          severity: "error",
          userMessage: "Could not load your saved settings — using defaults",
          context: { op: "hydrate", final: true },
        });
      }
    })();
  }, [enabled, load]);

  // 2) Settings write (debounced + retried)
  useEffect(() => {
    if (!enabled) return;
    const unsub = useBotStore.subscribe((s) => {
      if (settingsTimer.current) window.clearTimeout(settingsTimer.current);
      const snap: Record<string, unknown> = {};
      for (const k of SETTINGS_KEYS) snap[k] = (s as unknown as Record<string, unknown>)[k];
      settingsTimer.current = window.setTimeout(async () => {
        if (!(await hasSession())) return;
        retryWrite(
          () => saveSettings({ data: { settingsJson: JSON.stringify(snap) } }),
          "settings save",
        ).catch((e) => {
          if (isUnauthorized(e) || isNoSession(e)) return;
          logStructured(e, {
            category: "persistence",
            severity: "error",
            context: { op: "settings save", final: true },
          });
        });
      }, 800) as unknown as number;
    });
    return () => {
      unsub();
      if (settingsTimer.current) window.clearTimeout(settingsTimer.current);
    };
  }, [enabled, saveSettings]);

  // 3) Watchlist write (debounced + retried)
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
        mint_address: w.mintAddress ?? null,
        added_at: w.addedAt,
      }));
      watchTimer.current = window.setTimeout(async () => {
        if (!(await hasSession())) return;
        retryWrite(() => flushWatch({ data: { entries } }), "watchlist save").catch((e) => {
          if (isUnauthorized(e) || isNoSession(e)) return;
          logStructured(e, {
            category: "persistence",
            severity: "error",
            context: { op: "watchlist save", final: true },
          });
        });
      }, 1500) as unknown as number;
    });
    return () => {
      unsub();
      if (watchTimer.current) window.clearTimeout(watchTimer.current);
    };
  }, [enabled, flushWatch]);

  // 4) Log + trade flush (batched every 3s, retried per batch)
  useEffect(() => {
    if (!enabled) return;
    const iv = window.setInterval(async () => {
      if (!(await hasSession())) return;
      const s = useBotStore.getState();
      // logs — take everything newer than lastLogId
      const newLogs: typeof s.log = [];
      for (const l of s.log) {
        if (l.id === lastLogId.current) break;
        newLogs.push(l);
      }
      if (newLogs.length) {
        try {
          await retryWrite(
            () =>
              flushLogs({
                data: {
                  entries: newLogs.slice(0, 100).map((l) => ({
                    ts: l.ts,
                    type: l.type,
                    summary: l.summary,
                  })),
                },
              }),
            "logs flush",
          );
          lastLogId.current = s.log[0]?.id ?? lastLogId.current;
        } catch {
          /* next tick will retry — keep lastLogId untouched */
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
          await retryWrite(
            () =>
              flushTrade({
                data: {
                  client_id: t.id,
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
                  fee_tx_sig: t.feeTxSig ?? null,
                  settlement_status: t.settlementStatus,
                },
              }),
            "trade insert",
          );
        } catch (e) {
          if (isUnauthorized(e) || isNoSession(e)) continue;
          logStructured(e, {
            category: "persistence",
            severity: "error",
            context: { op: "trade insert", final: true, tradeId: t.id },
          });
        }
      }
      lastTradeId.current = s.tradeHistory[0]?.id ?? lastTradeId.current;
    }, 3_000);
    return () => window.clearInterval(iv);
  }, [enabled, flushLogs, flushTrade]);
}
