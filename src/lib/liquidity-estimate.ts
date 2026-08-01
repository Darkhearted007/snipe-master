/**
 * Liquidity estimation helpers for pump.fun bonding-curve tokens.
 *
 * DexScreener reports `liquidity.usd = null` for ALL pump.fun bonding-curve
 * pairs (dexId "pumpfun"). The tokens haven't migrated to an AMM yet, so
 * there's no LP pool for DexScreener to measure — but the bonding curve
 * itself IS the liquidity source. Without a non-zero liquidity value the
 * bot's `pushRealOpportunity` guard (`liquiditySol <= 0`) and
 * `applySafetyVerdict` liquidity gate (`liquiditySol < minLiquiditySol`)
 * reject every pump.fun token, so the bot never enters a trade.
 *
 * DexScreener DOES report `fdv` (fully-diluted valuation) and `marketCap`
 * for these tokens. We use these as a proxy for economic significance: a
 * token with a meaningful FDV has meaningful curve liquidity, even if
 * DexScreener can't express it as a pool USD figure.
 *
 * Estimation strategy:
 *   1. If `liquidity.usd` is present (AMM/pool tokens), use it directly.
 *   2. If null and `fdv`/`marketCap` is present, estimate liquidity as
 *      `fdv * ESTIMATE_RATIO` (clamped). This gives a conservative lower
 *      bound — the actual SOL reserves on the curve are usually several
 *      times the FDV-derived estimate, but we err low so the liquidity
 *      gate still filters out dust tokens.
 *   3. If all fields are null, return a small default (0) — the caller's
 *      existing guard will reject it, which is correct for tokens with
 *      no discoverable economic footprint.
 *
 * `SOL_PRICE_USD` is the same conversion factor used throughout the bot
 * (liquiditySol = liquidityUsd / 150). It's approximate but consistent.
 */

export const SOL_PRICE_USD = 150;

// Conservative: bonding-curve SOL reserves are typically 5-20% of FDV.
// We use the lower end so genuinely tiny tokens are still filtered out
// by the minLiquiditySol gate, while tokens with real traction pass.
const BONDING_CURVE_LIQ_RATIO = 0.1;

// Minimum FDV (in USD) to even attempt estimation. Below this, the token
// is too small to be worth the gas cost of a swap.
const MIN_FDV_USD = 500;

export interface LiquidityInput {
  liquidityUsd?: number | null;
  fdv?: number | null;
  marketCap?: number | null;
}

/**
 * Estimates the SOL-denominated liquidity of a token from DexScreener data.
 *
 * For AMM tokens (Raydium, pumpswap, etc.) `liquidity.usd` is populated and
 * used directly. For pump.fun bonding-curve tokens (dexId "pumpfun") the
 * field is null, so we derive a conservative estimate from FDV/marketCap.
 *
 * @returns liquidity in SOL (always >= 0)
 */
export function estimateLiquiditySol(input: LiquidityInput): number {
  const { liquidityUsd, fdv, marketCap } = input;

  // Prefer real pool liquidity when available.
  if (liquidityUsd != null && Number.isFinite(liquidityUsd) && liquidityUsd > 0) {
    return liquidityUsd / SOL_PRICE_USD;
  }

  // Fall back to FDV/marketCap for bonding-curve tokens.
  const valuation = fdv ?? marketCap ?? null;
  if (valuation != null && Number.isFinite(valuation) && valuation >= MIN_FDV_USD) {
    const estimatedUsd = valuation * BONDING_CURVE_LIQ_RATIO;
    return estimatedUsd / SOL_PRICE_USD;
  }

  // No usable data — return 0 so the caller's guard rejects it.
  return 0;
}

/**
 * Returns true if the token has enough economic significance to trade,
 * based on estimated liquidity. This is used to bypass the hard
 * `liquiditySol <= 0` rejection in pushRealOpportunity for pump.fun
 * bonding-curve tokens, while still filtering out dust/scam tokens.
 *
 * A pump.fun token with FDV >= MIN_FDV_USD is considered tradeable even
 * if DexScreener reports liquidity.usd = null.
 */
export function isBondingCurveTradeable(input: LiquidityInput): boolean {
  const { liquidityUsd, fdv, marketCap } = input;

  // Real liquidity — always tradeable if > 0.
  if (liquidityUsd != null && Number.isFinite(liquidityUsd) && liquidityUsd > 0) {
    return true;
  }

  // Bonding-curve token with sufficient FDV.
  const valuation = fdv ?? marketCap ?? null;
  return valuation != null && Number.isFinite(valuation) && valuation >= MIN_FDV_USD;
}
