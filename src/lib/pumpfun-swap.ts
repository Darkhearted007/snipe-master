// Client-side pump.fun bonding-curve swap execution.
//
// Jupiter cannot route pump.fun bonding-curve tokens (they're on pump.fun's
// internal constant-product curve, not an AMM). This module provides the
// alternative swap path: it asks our server endpoint (/api/pumpfun/buy) to
// build a pump.fun `buy_exact_sol_in` transaction, then the browser wallet
// signs it and we submit + confirm it the same way executeSwap does.
//
// The private key never touches this module or the server — signing happens
// entirely in the user's wallet extension, identical to the Jupiter path.

import { VersionedTransaction } from "@solana/web3.js";
import type { Connection, PublicKey } from "@solana/web3.js";

export interface PumpFunBuyParams {
  mint: string;
  amountLamports: number;
  slippageBps: number;
  priorityFeeLamports?: number;
}

export interface PumpFunBuyResult {
  signature: string;
  inAmount: string;
  outAmount: string;
  priceImpactPct: string;
}

export interface PumpFunSellParams {
  mint: string;
  slippageBps: number;
  priorityFeeLamports?: number;
  /** Optional: explicit token amount to sell (raw units as a string).
   * If omitted, the server sells the user's full ATA balance (full-exit). */
  tokenAmountRaw?: string;
}

export interface PumpFunSellResult {
  signature: string;
  tokensSold: string;
  solReceived: string;
  priceImpactPct: string;
}

export class PumpFunError extends Error {
  constructor(
    message: string,
    public readonly stage: "build" | "sign" | "send" | "confirm",
  ) {
    super(message);
    this.name = "PumpFunError";
  }
}

const PUMPFUN_BUY_URL = "/api/pumpfun/buy";
const PUMPFUN_SELL_URL = "/api/pumpfun/sell";

/**
 * Execute a pump.fun bonding-curve buy: server builds tx → wallet signs
 * (browser popup) → submit → confirm. Throws PumpFunError with a `.stage`
 * so callers can log exactly where a failed trade died.
 *
 * The `signTransaction` function comes from the wallet adapter — same as
 * the Jupiter path in use-live-execution.ts.
 */
export async function executePumpFunBuy(
  params: PumpFunBuyParams,
  connection: Connection,
  publicKey: PublicKey,
  signTransaction: (tx: VersionedTransaction) => Promise<VersionedTransaction>,
): Promise<PumpFunBuyResult> {
  const { mint, amountLamports, slippageBps, priorityFeeLamports } = params;

  // 1. Ask the server to build the pump.fun buy transaction
  let swapTransactionB64: string;
  let expectedTokensOut: string;
  try {
    const res = await fetch(PUMPFUN_BUY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mint,
        userPublicKey: publicKey.toBase58(),
        amountLamports: Math.floor(amountLamports),
        slippageBps,
        priorityFeeLamports,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new PumpFunError(`Buy build failed (${res.status}): ${body.slice(0, 200)}`, "build");
    }
    const data = (await res.json()) as {
      swapTransaction?: string;
      expectedTokensOut?: string;
      error?: string;
    };
    if (!data.swapTransaction) {
      throw new PumpFunError(data.error ?? "No swapTransaction returned", "build");
    }
    swapTransactionB64 = data.swapTransaction;
    expectedTokensOut = data.expectedTokensOut ?? "0";
  } catch (e) {
    if (e instanceof PumpFunError) throw e;
    throw new PumpFunError(
      `Buy build request failed: ${e instanceof Error ? e.message : String(e)}`,
      "build",
    );
  }

  // 2. Deserialize the transaction for wallet signing
  let tx: VersionedTransaction;
  try {
    tx = VersionedTransaction.deserialize(
      Uint8Array.from(atob(swapTransactionB64), (c) => c.charCodeAt(0)),
    );
  } catch (e) {
    throw new PumpFunError(
      `Failed to deserialize transaction: ${e instanceof Error ? e.message : String(e)}`,
      "build",
    );
  }

  // 3. Wallet signs (browser popup — the only place a private key is involved)
  let signed: VersionedTransaction;
  try {
    signed = await signTransaction(tx);
  } catch (e) {
    throw new PumpFunError(
      e instanceof Error ? e.message : "User rejected or wallet error",
      "sign",
    );
  }

  // 4. Submit to the network
  let signature: string;
  try {
    signature = await connection.sendRawTransaction(signed.serialize(), {
      skipPreflight: false,
      maxRetries: 3,
    });
  } catch (e) {
    throw new PumpFunError(e instanceof Error ? e.message : "Failed to submit transaction", "send");
  }

  // 5. Confirm the transaction
  try {
    const latestBlockhash = await connection.getLatestBlockhash();
    const confirmation = await connection.confirmTransaction(
      { signature, ...latestBlockhash },
      "confirmed",
    );
    if (confirmation.value.err) {
      throw new Error(JSON.stringify(confirmation.value.err));
    }
  } catch (e) {
    // Transaction submitted but confirmation failed/timed out.
    // Surface the signature so the caller can look it up manually.
    throw new PumpFunError(
      `Submitted (sig ${signature}) but confirmation failed: ${
        e instanceof Error ? e.message : String(e)
      }`,
      "confirm",
    );
  }

  return {
    signature,
    inAmount: String(Math.floor(amountLamports)),
    outAmount: expectedTokensOut,
    // pump.fun doesn't provide price impact in the same way Jupiter does;
    // the constant-product math is deterministic, so we report "0" and let
    // the caller use the expectedTokensOut for logging.
    priceImpactPct: "0",
  };
}

/**
 * Execute a pump.fun bonding-curve sell: server builds tx \u2192 wallet signs
 * (browser popup) \u2192 submit \u2192 confirm. Throws PumpFunError with a `.stage`
 * so callers can log exactly where a failed exit died.
 *
 * If `tokenAmountRaw` is omitted, the server fetches the user's full ATA
 * balance and sells everything (full-exit). This is the common case for
 * TP/SL-triggered exits and manual Close buttons.
 *
 * The `signTransaction` function comes from the wallet adapter \u2014 same as
 * the buy path. The private key never touches this module or the server.
 */
export async function executePumpFunSell(
  params: PumpFunSellParams,
  connection: Connection,
  publicKey: PublicKey,
  signTransaction: (tx: VersionedTransaction) => Promise<VersionedTransaction>,
): Promise<PumpFunSellResult> {
  const { mint, slippageBps, priorityFeeLamports, tokenAmountRaw } = params;

  // 1. Ask the server to build the pump.fun sell transaction
  let swapTransactionB64: string;
  let tokensSold: string;
  let expectedSolOut: string;
  try {
    const res = await fetch(PUMPFUN_SELL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mint,
        userPublicKey: publicKey.toBase58(),
        slippageBps,
        priorityFeeLamports,
        tokenAmountRaw,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new PumpFunError(`Sell build failed (${res.status}): ${body.slice(0, 200)}`, "build");
    }
    const data = (await res.json()) as {
      swapTransaction?: string;
      tokensToSell?: string;
      expectedSolOut?: string;
      error?: string;
    };
    if (!data.swapTransaction) {
      throw new PumpFunError(data.error ?? "No swapTransaction returned", "build");
    }
    swapTransactionB64 = data.swapTransaction;
    tokensSold = data.tokensToSell ?? "0";
    expectedSolOut = data.expectedSolOut ?? "0";
  } catch (e) {
    if (e instanceof PumpFunError) throw e;
    throw new PumpFunError(
      `Sell build request failed: ${e instanceof Error ? e.message : String(e)}`,
      "build",
    );
  }

  // 2. Deserialize the transaction for wallet signing
  let tx: VersionedTransaction;
  try {
    tx = VersionedTransaction.deserialize(
      Uint8Array.from(atob(swapTransactionB64), (c) => c.charCodeAt(0)),
    );
  } catch (e) {
    throw new PumpFunError(
      `Failed to deserialize transaction: ${e instanceof Error ? e.message : String(e)}`,
      "build",
    );
  }

  // 3. Wallet signs (browser popup \u2014 the only place a private key is involved)
  let signed: VersionedTransaction;
  try {
    signed = await signTransaction(tx);
  } catch (e) {
    throw new PumpFunError(
      e instanceof Error ? e.message : "User rejected or wallet error",
      "sign",
    );
  }

  // 4. Submit to the network
  let signature: string;
  try {
    signature = await connection.sendRawTransaction(signed.serialize(), {
      skipPreflight: false,
      maxRetries: 3,
    });
  } catch (e) {
    throw new PumpFunError(e instanceof Error ? e.message : "Failed to submit transaction", "send");
  }

  // 5. Confirm the transaction
  try {
    const latestBlockhash = await connection.getLatestBlockhash();
    const confirmation = await connection.confirmTransaction(
      { signature, ...latestBlockhash },
      "confirmed",
    );
    if (confirmation.value.err) {
      throw new Error(JSON.stringify(confirmation.value.err));
    }
  } catch (e) {
    // Transaction submitted but confirmation failed/timed out.
    // Surface the signature so the caller can look it up manually.
    throw new PumpFunError(
      `Submitted (sig ${signature}) but confirmation failed: ${
        e instanceof Error ? e.message : String(e)
      }`,
      "confirm",
    );
  }

  return {
    signature,
    tokensSold,
    solReceived: expectedSolOut,
    // pump.fun constant-product math is deterministic; report "0" and let
    // the caller use expectedSolOut for logging.
    priceImpactPct: "0",
  };
}
