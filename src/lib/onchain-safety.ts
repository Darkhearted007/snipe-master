// Ported from SniperBot's src/safety/onChainSafety.js + tokenSafety.js.
// LP lock/burn detection uses a real LP mint resolved from the pool-creation
// transaction's account layout (see resolveLpMint in pool-discovery.ts) —
// index 7 for Raydium AMM v4's initialize2, index 6 for Raydium CPMM's
// Initialize. Pump.fun has no separate LP mint pre-migration (bonding
// curve model), so lpMint is null there and the check reports
// "not-applicable" rather than penalizing a token for a check that
// structurally doesn't apply to it yet.

import { rpcRequest } from "./solana-rpc-server";

export const SOL_MINT = "So11111111111111111111111111111111111111112";

/**
 * Minimal, self-contained Jupiter quote call for the honeypot probe only.
 * Deliberately does not import from either execution path's Jupiter client
 * (this repo has jupiter-client.ts wired to live trade execution) — a safety
 * check must never share code with, or create a hidden dependency on, the
 * thing it's supposed to be checking.
 */
async function getSafetyProbeQuote(params: {
  inputMint: string;
  outputMint: string;
  amountLamports: number;
  slippageBps: number;
}): Promise<{ outAmount: string; priceImpactPct: string }> {
  // lite-api.jup.ag is deprecated (Jupiter is progressively rate-limiting it
  // to zero in favor of api.jup.ag + x-api-key). This runs server-side only
  // (invoked from api/discovery.ts, api/rugcheck.$mint.ts, the Helius
  // webhook — never the browser), so it's safe to read the key here.
  // Deliberately its own fetch/header logic — no import from jupiter.ts or
  // jupiter-client.ts — to keep the "safety check shares no code with the
  // thing it's checking" property intact.
  const key = process.env.JUPITER_API_KEY;
  const base = key ? "https://api.jup.ag/swap/v1/quote" : "https://quote-api.jup.ag/v6/quote";
  const url = new URL(base);
  url.searchParams.set("inputMint", params.inputMint);
  url.searchParams.set("outputMint", params.outputMint);
  url.searchParams.set("amount", String(Math.floor(params.amountLamports)));
  url.searchParams.set("slippageBps", String(params.slippageBps));
  url.searchParams.set("restrictIntermediateTokens", "true");
  const res = await fetch(url.toString(), {
    headers: key
      ? { "x-api-key": key, accept: "application/json" }
      : { accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`quote HTTP ${res.status}`);
  }
  const raw = (await res.json()) as { outAmount?: string; priceImpactPct?: string };
  if (!raw.outAmount) throw new Error("no route found");
  return { outAmount: raw.outAmount, priceImpactPct: raw.priceImpactPct ?? "0" };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Decodes a base64 SPL mint account far enough to read mint/freeze
 * authority option flags. Token-2022 mints share the same leading offsets.
 */
function parseMintAccount(base64Data: string): {
  mintAuthorityActive: boolean;
  freezeAuthorityActive: boolean;
} {
  const buffer = Buffer.from(base64Data, "base64");
  if (buffer.length < 82) {
    throw new Error("Mint account data is smaller than the expected SPL mint layout");
  }
  const mintAuthorityOption = buffer.readUInt32LE(0);
  // offset 46 = mintAuthorityOption(4) + mintAuthority(32) + supply(8) + decimals(1) + isInitialized(1)
  const freezeAuthorityOption = buffer.readUInt32LE(46);
  return {
    mintAuthorityActive: mintAuthorityOption === 1,
    freezeAuthorityActive: freezeAuthorityOption === 1,
  };
}

// Same placeholder caveat as upstream SniperBot: this is a generic locker
// program ID, not a specific audited one. Treat "locked" results from it
// with the same skepticism you'd give an unverified claim — override with
// real locker program IDs (Streamflow, Bonfida, etc.) as you identify the
// specific lockers actually in use on the venues you trade.
const KNOWN_BURN_ADDRESSES = new Set([
  "1nc1nerator11111111111111111111111111111111",
  "11111111111111111111111111111111111111111",
]);
const KNOWN_LOCKER_PROGRAM_IDS = new Set([
  "FoQ4d1Y6Snm71ryecwRBqPDL9wcnkCcbSVN1oCyRJ6Bw", // Streamflow
  "LocktDzaV1W2Bm9DeZeiyz4J9zs4fRqNiYqQyracRXw", // generic placeholder — unverified
]);

async function checkLpLockOrBurn(lpMint: string | null): Promise<SafetyResult["lpStatus"]> {
  if (!lpMint) {
    return { lpStatus: "not-applicable", reason: "no-lp-mint-for-this-venue" };
  }
  try {
    const result = await rpcRequest<{ value: Array<{ address: string; amount: string }> }>(
      "getTokenLargestAccounts",
      [lpMint],
    );
    const accounts = result?.value ?? [];
    if (accounts.length === 0) {
      return { lpStatus: "unknown", reason: "no-lp-holder-data" };
    }
    const totalSupply = accounts.reduce((sum, a) => sum + Number(a.amount || 0), 0);
    if (totalSupply <= 0) {
      return { lpStatus: "burned", reason: "lp-supply-zero" };
    }
    const largest = accounts[0];
    if (KNOWN_BURN_ADDRESSES.has(largest.address)) {
      return { lpStatus: "burned" };
    }
    const ownerInfo = await rpcRequest<{ value: { owner: string } | null }>("getAccountInfo", [
      largest.address,
      { encoding: "base64" },
    ]);
    const owner = ownerInfo?.value?.owner;
    if (owner && KNOWN_LOCKER_PROGRAM_IDS.has(owner)) {
      return { lpStatus: "locked", reason: `locker-program:${owner}` };
    }
    return { lpStatus: "unlocked", reason: "largest-lp-holder-is-a-wallet" };
  } catch (error) {
    return {
      lpStatus: "unknown",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export interface SafetyResult {
  mint: string;
  authority: {
    mintAuthorityActive: boolean | null;
    freezeAuthorityActive: boolean | null;
    error?: string;
  };
  holders: { topHolderPct: number | null; holderSampleSize: number; error?: string };
  lpStatus: {
    lpStatus: "unknown" | "locked" | "burned" | "unlocked" | "not-applicable";
    reason?: string;
  };
  honeypot: { sellable: boolean | null; priceImpactPct?: number | null; reason?: string };
  liquidityUsd: number | null;
  score: number; // 0-100, folds all checks into a single number
  reasons: string[];
  evaluatedAt: string;
}

async function checkMintAuthority(mint: string): Promise<SafetyResult["authority"]> {
  try {
    const result = await rpcRequest<{ value: { data: [string, string] } | null }>(
      "getAccountInfo",
      [mint, { encoding: "base64" }],
    );
    if (!result?.value?.data?.[0]) {
      return {
        mintAuthorityActive: null,
        freezeAuthorityActive: null,
        error: "mint-account-not-found",
      };
    }
    return parseMintAccount(result.value.data[0]);
  } catch (error) {
    return {
      mintAuthorityActive: null,
      freezeAuthorityActive: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkHolderConcentration(mint: string): Promise<SafetyResult["holders"]> {
  try {
    const result = await rpcRequest<{ value: Array<{ amount: string }> }>(
      "getTokenLargestAccounts",
      [mint],
    );
    const accounts = result?.value ?? [];
    if (accounts.length === 0) {
      return { topHolderPct: null, holderSampleSize: 0, error: "no-holder-data" };
    }
    const totalSampled = accounts.reduce((sum, a) => sum + Number(a.amount || 0), 0);
    const topSum = accounts.slice(0, 10).reduce((sum, a) => sum + Number(a.amount || 0), 0);
    const topHolderPct = totalSampled > 0 ? clamp(topSum / totalSampled, 0, 1) : null;
    return { topHolderPct, holderSampleSize: accounts.length };
  } catch (error) {
    return {
      topHolderPct: null,
      holderSampleSize: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Lightweight honeypot check: quote buying a small fixed SOL amount, then
 * quote selling that exact output straight back. If the reverse quote
 * returns nothing (or errors), the token likely can't be sold — classic
 * honeypot pattern.
 *
 * IMPORTANT distinction:
 *  - sellable === false  → CONFIRMED honeypot (reverse quote returned zero).
 *    This is the only case that should trigger the score=0 hard fail.
 *  - sellable === null   → INCONCLUSIVE (forward quote failed, no route,
 *    network error, rate limit). This is NOT a honeypot confirmation —
 *    it's an infrastructure failure. Pump.fun bonding-curve tokens often
 *    fail here because Jupiter can't route them pre-migration; treating
 *    that as "honeypot" caused every pump.fun token to get score=0 and
 *    verdict="danger", which is why the bot skipped all trades.
 *  - sellable === true   → token can be bought and sold back.
 *
 * When lpMint === null (pump.fun bonding curve), the honeypot probe is
 * skipped entirely: Jupiter doesn't route pump.fun bonding-curve tokens,
 * so the probe would always fail with "no route found" and produce a
 * false-positive honeypot verdict. sellable is set to null with a clear
 * reason instead.
 */
async function checkHoneypot(
  mint: string,
  lpMint: string | null = null,
): Promise<{ result: SafetyResult["honeypot"]; liquidityProbeOutAmount: string | null }> {
  // Pump.fun bonding-curve tokens are not Jupiter-routable pre-migration.
  // Running the probe would always fail → false-positive honeypot.
  if (lpMint == null) {
    return {
      result: { sellable: null, reason: "bonding-curve-not-jupiter-routable" },
      liquidityProbeOutAmount: null,
    };
  }

  const PROBE_LAMPORTS = 10_000_000; // 0.01 SOL — small enough not to move price
  try {
    const forward = await getSafetyProbeQuote({
      inputMint: SOL_MINT,
      outputMint: mint,
      amountLamports: PROBE_LAMPORTS,
      slippageBps: 300,
    });
    const reverse = await getSafetyProbeQuote({
      inputMint: mint,
      outputMint: SOL_MINT,
      amountLamports: Number(forward.outAmount),
      slippageBps: 300,
    });
    const outAmount = Number(reverse.outAmount);
    if (!(outAmount > 0)) {
      // CONFIRMED honeypot: we could buy but selling back returns nothing.
      return {
        result: { sellable: false, reason: "reverse-quote-returned-zero" },
        liquidityProbeOutAmount: forward.outAmount,
      };
    }
    return {
      result: { sellable: true, priceImpactPct: Number.parseFloat(reverse.priceImpactPct) },
      liquidityProbeOutAmount: forward.outAmount,
    };
  } catch (error) {
    // INCONCLUSIVE: the probe failed for infrastructure reasons (no route
    // found, network error, rate limit, deprecated API). This is NOT a
    // confirmed honeypot — treat it as unknown, not as sellable=false.
    const reason = error instanceof Error ? error.message : String(error);
    return {
      result: { sellable: null, reason: `probe-failed: ${reason}` },
      liquidityProbeOutAmount: null,
    };
  }
}

/**
 * Full safety evaluation for one mint. No caching here — the caller (the
 * webhook handler) only evaluates each mint once, at discovery time.
 */
export async function evaluateMintSafety(
  mint: string,
  lpMint: string | null = null,
): Promise<SafetyResult> {
  const [authority, holders, honeypotCheck, lpStatus] = await Promise.all([
    checkMintAuthority(mint),
    checkHolderConcentration(mint),
    checkHoneypot(mint, lpMint),
    checkLpLockOrBurn(lpMint),
  ]);

  const reasons: string[] = [];
  let score = 100;

  // Pump.fun bonding-curve tokens (lpMint === null → lpStatus will be
  // "not-applicable") ALWAYS have active mint + freeze authority pre-
  // migration — these are only revoked after the token migrates to an AMM
  // like Raydium. Penalizing -35 each for this structurally-normal state
  // drove every pump.fun token's score to 30, below the minSafety threshold,
  // causing the bot to skip every trade. For bonding-curve tokens we use a
  // reduced penalty (-10 each) that reflects "this token can still be
  // minted/frozen but that's expected at this stage" rather than treating
  // it as a critical rug risk. Tokens that have already migrated (lpMint
  // != null) still get the full -35 penalty — active authority on a
  // migrated token IS a real red flag.
  const isPumpFunBondingCurve = lpMint == null;
  const authorityPenalty = isPumpFunBondingCurve ? 10 : 35;

  if (authority.mintAuthorityActive !== false) {
    reasons.push("mint-authority-not-revoked");
    score -= authorityPenalty;
  }
  if (authority.freezeAuthorityActive !== false) {
    reasons.push("freeze-authority-not-revoked");
    score -= authorityPenalty;
  }
  if (typeof holders.topHolderPct === "number" && holders.topHolderPct > 0.5) {
    reasons.push("holder-concentration-too-high");
    score -= 15;
  }
  // Real LP lock/burn signal now. "not-applicable" (pump.fun bonding curve,
  // no separate LP token yet) is treated as neutral — there's genuinely
  // nothing to check pre-migration, so it costs nothing. "unlocked" is the
  // single biggest rug vector (dev can pull liquidity any time) and is
  // penalized hard. "unknown" (RPC failure, no holder data) is still a
  // real gap and costs points, just less than a confirmed-unlocked LP.
  if (lpStatus.lpStatus === "unlocked") {
    reasons.push("lp-not-locked-or-burned");
    score -= 30;
  } else if (lpStatus.lpStatus === "unknown") {
    reasons.push("lp-lock-status-check-failed");
    score -= 10;
  }
  // Honeypot check: only a CONFIRMED honeypot (sellable === false, meaning
  // we could buy but the reverse sell quote returned zero) is a hard fail
  // that zeroes the score. An inconclusive probe (sellable === null —
  // Jupiter couldn't route, network error, rate limit) is NOT a honeypot
  // confirmation; it gets a small penalty for the uncertainty but doesn't
  // block trading. Previously, any probe failure was treated as sellable
  // === false, which zeroed the score for every pump.fun token (Jupiter
  // can't route bonding-curve tokens) and caused the bot to skip all trades.
  if (honeypotCheck.result.sellable === false) {
    reasons.push("honeypot-sell-check-failed");
    score = 0; // hard fail regardless of other checks — this is the one that loses funds outright
  } else if (honeypotCheck.result.sellable === null) {
    reasons.push(`honeypot-probe-inconclusive:${honeypotCheck.result.reason ?? "unknown"}`);
    score -= 10; // small penalty for uncertainty, not a hard fail
  }

  return {
    mint,
    authority,
    holders,
    lpStatus,
    honeypot: honeypotCheck.result,
    liquidityUsd: null, // TODO: needs a SOL/USD price feed; out of scope for this pass
    score: clamp(Math.round(score), 0, 100),
    reasons,
    evaluatedAt: new Date().toISOString(),
  };
}
