// Pure exit-decision logic shared by paper and live positions.
//
// Both exit branches inside `tick()` (bot-store) previously inlined this
// math. It is extracted here so the sniper-exit behavior — stop-loss, the
// ratcheted take-profit, and the trailing stop — can be unit-tested in
// isolation. The store calls evaluateExit() with the position's current
// price, entry, observed peak, TP/SL levels and the user's SafetyFilters,
// then applies whatever signal comes back.
//
// Semantics (keep in sync with the store):
//   1. Stop-loss always wins and is checked first.
//   2. With the trailing stop OFF, the fixed take-profit fires immediately
//      once current >= tp (the original behavior).
//   3. With the trailing stop ON, the exit level is the highest of:
//        - the breakeven floor (entry — never exit below entry),
//        - the trail distance off the observed peak,
//        - the ratcheted take-profit: once the price has EVER reached tp
//          (peak >= tp), any pullback to the target banks the profit.
//      A pullback to that level fires the "trail" exit.
//   4. The trailing stop only arms once the position has ever been in
//      profit (peak > entry). A position that never gained above entry is
//      only exited by the stop-loss.
export interface ExitDecisionInput {
  /** Current mark price. */
  current: number;
  /** Entry price — also the breakeven floor for the trailing stop. */
  entry: number;
  /** Highest price observed so far (must be >= current). */
  peak: number;
  /** Take-profit price level (0 = no take-profit set). */
  tp: number;
  /** Stop-loss price level (0 = no stop-loss set). */
  sl: number;
  /** Whether the trailing stop is enabled (sniper exits). */
  trailingStopEnabled: boolean;
  /** Trailing-stop distance as a percentage (6 = 6% off the peak). */
  trailingStopPct: number;
}

export type ExitReason = "sl" | "tp" | "trail";

export type ExitDecision = { fire: false } | { fire: true; reason: ExitReason; level: number };

export function evaluateExit(input: ExitDecisionInput): ExitDecision {
  const { current, entry, peak, tp, sl, trailingStopEnabled, trailingStopPct } = input;

  // Stop-loss always wins — checked first, takes precedence over both the
  // take-profit and the trailing stop.
  if (sl > 0 && current <= sl) return { fire: true, reason: "sl", level: sl };

  // The trailing stop only arms once the position has ever been in profit
  // (peak > entry). Until then there is nothing to trail.
  const trailingActive = trailingStopEnabled && peak > entry;

  const trailLevel = trailingActive
    ? Math.max(
        // Breakeven floor — the trail never exits below entry.
        entry,
        // Trail distance from the observed peak.
        peak * (1 - trailingStopPct / 100),
        // Ratcheted take-profit floor: once the price has EVER reached tp,
        // the exit level rises to at least tp so a stall or pullback to the
        // target banks the defined profit instead of giving it back.
        peak >= tp && tp > 0 ? tp : 0,
      )
    : Number.POSITIVE_INFINITY;

  // An unarmed trail (trailingActive false → trailLevel = +Infinity) never
  // fires: a position that hasn't gained above entry is only exited by the
  // stop-loss, never by the trail. (Without this guard, `current <=
  // Infinity` is always true and a mere dip — even above the SL — would
  // instantly "trail-exit" a position that never went green.)
  if (trailingActive && current <= trailLevel) {
    return { fire: true, reason: "trail", level: trailLevel };
  }

  // With the trailing stop OFF, the fixed take-profit fires immediately at
  // the target (the original behavior).
  if (!trailingStopEnabled && tp > 0 && current >= tp) {
    return { fire: true, reason: "tp", level: tp };
  }

  return { fire: false };
}
