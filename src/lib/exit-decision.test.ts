import { describe, expect, test } from "vitest";
import { evaluateExit } from "./exit-decision";

// Default position: entry 1.0, TP +10% (1.1), SL -5% (0.95), trail 6%.
function decision(overrides: Partial<Parameters<typeof evaluateExit>[0]> = {}) {
  return evaluateExit({
    current: 1.0,
    entry: 1.0,
    peak: 1.0,
    tp: 1.1,
    sl: 0.95,
    trailingStopEnabled: true,
    trailingStopPct: 6,
    ...overrides,
  });
}

describe("stop-loss", () => {
  test("fires when current crosses below SL", () => {
    expect(decision({ current: 0.94, peak: 1.05 })).toEqual({
      fire: true,
      reason: "sl",
      level: 0.95,
    });
  });

  test("fires exactly at the SL boundary (<=)", () => {
    expect(decision({ current: 0.95, peak: 1.02 })).toEqual({
      fire: true,
      reason: "sl",
      level: 0.95,
    });
  });

  test("takes precedence over trail and TP", () => {
    // Trail would also be armed (peak 1.05 > entry) — SL still wins.
    expect(decision({ current: 0.94, peak: 1.05 })).toEqual({
      fire: true,
      reason: "sl",
      level: 0.95,
    });
  });

  test("does nothing when no SL is set (sl = 0)", () => {
    // Never in profit + no SL: the position rides to zero rather than
    // exiting — matches the pre-existing sl=0 semantics.
    expect(decision({ current: 0.5, peak: 1.0, sl: 0 })).toEqual({ fire: false });
  });
});

describe("take-profit (trailing OFF)", () => {
  test("fires immediately at the target", () => {
    expect(decision({ current: 1.11, trailingStopEnabled: false })).toEqual({
      fire: true,
      reason: "tp",
      level: 1.1,
    });
  });

  test("fires exactly at the target boundary (>=)", () => {
    expect(decision({ current: 1.1, trailingStopEnabled: false })).toEqual({
      fire: true,
      reason: "tp",
      level: 1.1,
    });
  });

  test("does not fire below the target", () => {
    expect(decision({ current: 1.05, trailingStopEnabled: false })).toEqual({ fire: false });
  });

  test("never fires when no TP is set", () => {
    expect(decision({ current: 1.2, tp: 0, trailingStopEnabled: false })).toEqual({ fire: false });
  });
});

describe("trailing stop (trailing ON)", () => {
  test("does not fire while the price holds near the peak", () => {
    expect(decision({ current: 1.05, peak: 1.05 })).toEqual({ fire: false });
  });

  test("does not fire on a pullback smaller than the trail distance", () => {
    // 6% off peak 1.05 = 0.987 → breakeven floor 1.0 wins; 1.03 > 1.0.
    expect(decision({ current: 1.03, peak: 1.05 })).toEqual({ fire: false });
  });

  test("fires at the breakeven floor when a gain is fully given back", () => {
    expect(decision({ current: 0.99, peak: 1.05 })).toEqual({
      fire: true,
      reason: "trail",
      level: 1.0,
    });
  });

  test("never exits below entry (breakeven floor)", () => {
    // No SL or TP set, so the trail alone decides: peak 1.05 → 6% trail is
    // 0.987, but the floor clamps the exit level up to entry (1.0) — never
    // below, even on a catastrophic pullback from the peak.
    const r = decision({ current: 0.5, peak: 1.05, sl: 0, tp: 0 });
    expect(r).toEqual({ fire: true, reason: "trail", level: 1.0 });
  });

  test("does not arm when the position never gained above entry", () => {
    expect(decision({ current: 0.97, peak: 1.0 })).toEqual({ fire: false });
  });

  test("fires on a full trail pullback from the peak", () => {
    // peak 1.5 → trail 1.41 (6% off). A pullback to 1.41 banks +41%.
    expect(decision({ current: 1.41, peak: 1.5 })).toEqual({
      fire: true,
      reason: "trail",
      level: 1.41,
    });
  });

  test("holds above the trail level on a runner", () => {
    expect(decision({ current: 1.45, peak: 1.5 })).toEqual({ fire: false });
  });
});

describe("ratcheted take-profit (trailing ON)", () => {
  test("banks the target once the price has EVER reached it", () => {
    // peak 1.15 >= tp 1.1 → exit floor rises to 1.1. A pullback to the
    // target (from 1.15) triggers the sell instead of riding back to entry.
    expect(decision({ current: 1.1, peak: 1.15 })).toEqual({
      fire: true,
      reason: "trail",
      level: 1.1,
    });
  });

  test("fires exactly when the price touches tp after having been above it", () => {
    expect(decision({ current: 1.1, peak: 1.1 })).toEqual({
      fire: true,
      reason: "trail",
      level: 1.1,
    });
  });

  test("still rides above the ratcheted floor", () => {
    // peak 1.15, price 1.12 — above the 1.1 floor and above the 6% trail
    // (1.081) → keep riding.
    expect(decision({ current: 1.12, peak: 1.15 })).toEqual({ fire: false });
  });

  test("ratchet is disabled when no TP is set", () => {
    // peak 1.2, tp 0 → floor is max(entry 1.0, trail 1.128) = 1.128.
    expect(decision({ current: 1.13, tp: 0, peak: 1.2 })).toEqual({ fire: false });
    expect(decision({ current: 1.128, tp: 0, peak: 1.2 })).toEqual({
      fire: true,
      reason: "trail",
      level: 1.128,
    });
  });
});
