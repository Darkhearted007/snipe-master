import { useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { VersionedTransaction } from "@solana/web3.js";
import {
  JupiterError,
  assertSafePriceImpact,
  buildSwapTransaction,
  getQuote,
} from "../lib/jupiter";
import { PumpFunError, executePumpFunBuy } from "../lib/pumpfun-swap";

export interface LiveSwapParams {
  inputMint: string;
  outputMint: string;
  amountLamports: number;
  slippageBps: number;
  maxPriceImpactPct: number;
  priorityFeeLamports?: number;
  /** When true, route through the pump.fun bonding-curve program instead of Jupiter. */
  isPumpFunBondingCurve?: boolean;
}

export interface LiveSwapResult {
  signature: string;
  inAmount: string;
  outAmount: string;
  priceImpactPct: string;
}

/**
 * Executes one real swap end-to-end. Routes to the correct swap engine
 * based on `isPumpFunBondingCurve`:
 *
 *   - pump.fun bonding-curve tokens → /api/pumpfun/buy (pump.fun program)
 *   - everything else (AMM tokens, migrated pump.fun) → Jupiter aggregator
 *
 * Both paths end the same way: wallet signs (browser popup) → submit →
 * confirm. The private key never touches this module or the server.
 */
export function useLiveExecution() {
  const { connection } = useConnection();
  const { publicKey, signTransaction, connected } = useWallet();

  const executeSwap = useCallback(
    async (params: LiveSwapParams): Promise<LiveSwapResult> => {
      if (!connected || !publicKey || !signTransaction) {
        throw new JupiterError("Wallet not connected", "quote");
      }

      // --- Pump.fun bonding-curve path ---
      // Jupiter cannot route pump.fun bonding-curve tokens (they're on
      // pump.fun's internal curve, not an AMM). Route these to the pump.fun
      // program directly via our server-side transaction builder.
      if (params.isPumpFunBondingCurve) {
        const result = await executePumpFunBuy(
          {
            mint: params.outputMint,
            amountLamports: params.amountLamports,
            slippageBps: params.slippageBps,
            priorityFeeLamports: params.priorityFeeLamports,
          },
          connection,
          publicKey,
          signTransaction,
        );
        // Convert PumpFunError stages to match the JupiterError stage
        // convention so callers logging `err.stage` get consistent values.
        return {
          signature: result.signature,
          inAmount: result.inAmount,
          outAmount: result.outAmount,
          priceImpactPct: result.priceImpactPct,
        };
      }

      // --- Jupiter path (AMM tokens, graduated pump.fun, Raydium, etc.) ---
      const quote = await getQuote({
        inputMint: params.inputMint,
        outputMint: params.outputMint,
        amountLamports: params.amountLamports,
        slippageBps: params.slippageBps,
      });

      // Hard guard, independent of whatever slippage setting the UI has —
      // a route with insane price impact should never silently execute.
      assertSafePriceImpact(quote, params.maxPriceImpactPct);

      const swapTxBase64 = await buildSwapTransaction({
        quote,
        userPublicKey: publicKey.toBase58(),
        priorityFeeLamports: params.priorityFeeLamports,
      });

      const tx = VersionedTransaction.deserialize(
        Uint8Array.from(atob(swapTxBase64), (c) => c.charCodeAt(0)),
      );

      // This is the browser wallet popup — the only place a private key
      // is ever involved. Nothing server-side ever sees it.
      let signed: VersionedTransaction;
      try {
        signed = await signTransaction(tx);
      } catch (e) {
        throw new JupiterError(
          e instanceof Error ? e.message : "User rejected or wallet error",
          "swap",
        );
      }

      let signature: string;
      try {
        signature = await connection.sendRawTransaction(signed.serialize(), {
          skipPreflight: false,
          maxRetries: 3,
        });
      } catch (e) {
        throw new JupiterError(
          e instanceof Error ? e.message : "Failed to submit transaction",
          "send",
        );
      }

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
        // Transaction was submitted but confirmation failed/timed out.
        // Do NOT assume success — surface the signature so the caller can
        // look it up manually rather than silently crediting a fill.
        throw new JupiterError(
          `Submitted (sig ${signature}) but confirmation failed: ${
            e instanceof Error ? e.message : String(e)
          }`,
          "confirm",
        );
      }

      return {
        signature,
        inAmount: quote.inAmount,
        outAmount: quote.outAmount,
        priceImpactPct: quote.priceImpactPct,
      };
    },
    [connection, connected, publicKey, signTransaction],
  );

  return { executeSwap, walletReady: connected && !!publicKey };
}
