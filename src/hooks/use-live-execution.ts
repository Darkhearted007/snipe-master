import { useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Connection, PublicKey, VersionedTransaction } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@/lib/pumpfun-constants";
import {
  JupiterError,
  assertSafePriceImpact,
  buildSwapTransaction,
  getQuote,
  SOL_MINT,
  type JupiterQuote,
} from "../lib/jupiter";
import { PumpFunError, buildPumpFunBuyTransaction, executePumpFunBuy, executePumpFunSell } from "../lib/pumpfun-swap";
import { useSniperSigner } from "@/components/sniper-signer-provider";

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

export interface LiveSellParams {
  /** The token mint to sell. */
  mint: string;
  slippageBps: number;
  maxPriceImpactPct: number;
  priorityFeeLamports?: number;
  /** When true, route through the pump.fun bonding-curve sell program. */
  isPumpFunBondingCurve?: boolean;
  /** Optional: explicit token amount to sell (raw units as a string).
   * If omitted, sells the user's full ATA balance (full-exit). */
  tokenAmountRaw?: string;
}

export interface LiveSellResult {
  signature: string;
  tokensSold: string;
  solReceived: string;
  priceImpactPct: string;
}

/** Derive the Associated Token Account for (owner, mint) — client-side. */
function getAssociatedTokenAddress(owner: PublicKey, mint: PublicKey): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return ata;
}

/**
 * Resolve the wallet's current on-chain token balance for a mint (raw
 * units as a string). Used for full-exit sells: the entry-time expected
 * token output (`tokensReceivedRaw`) is stale the moment the market moves,
 * and a sell that tries to move more tokens than the ATA holds fails
 * on-chain — which is why exits looked broken vs paper mode. Reading the
 * real balance makes exits as reliable as the paper-trade close.
 */
async function resolveTokenBalance(
  connection: Connection,
  owner: PublicKey,
  mint: string,
): Promise<string> {
  const ata = getAssociatedTokenAddress(owner, new PublicKey(mint));
  const { value } = await connection.getTokenAccountBalance(ata);
  return value.amount;
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
  const { publicKey, signTransaction, signAllTransactions, connected } = useWallet();
  const { signer: sniper } = useSniperSigner();

  // When the Sniper Signer (burner key) is armed it replaces the browser
  // wallet extension as the signing path — same interface, no popups, so
  // buys/sells can execute unattended. The wallet adapter is the fallback
  // when no signer is set (Option B / manual popups).
  const effectivePublicKey = sniper?.publicKey ?? publicKey;
  const effectiveSignTransaction = sniper ? sniper.signTransaction : signTransaction;
  // Batch signing (one wallet approval for several transactions) — used by
  // executeLiveSells for wallet auto-approve bursts. The Sniper Signer
  // signs instantly anyway; the extension wallet signs all txs in one
  // approval dialog.
  const effectiveSignAllTransactions = sniper ? sniper.signAllTransactions : signAllTransactions;
  const ready = !!effectivePublicKey && !!effectiveSignTransaction;

  const executeSwap = useCallback(
    async (params: LiveSwapParams): Promise<LiveSwapResult> => {
      if (!effectivePublicKey || !effectiveSignTransaction) {
        throw new JupiterError("No signing wallet — connect one or arm the Sniper Signer", "quote");
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
          effectivePublicKey,
          effectiveSignTransaction,
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
        userPublicKey: effectivePublicKey.toBase58(),
        priorityFeeLamports: params.priorityFeeLamports,
      });

      const tx = VersionedTransaction.deserialize(
        Uint8Array.from(atob(swapTxBase64), (c) => c.charCodeAt(0)),
      );

      // This is the browser wallet popup — the only place a private key
      // is ever involved. Nothing server-side ever sees it.
      let signed: VersionedTransaction;
      try {
        signed = await effectiveSignTransaction(tx);
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
    [connection, effectivePublicKey, effectiveSignTransaction],
  );

  /**
   * Executes a real sell (exit) swap end-to-end. Routes to the correct sell
   * engine based on `isPumpFunBondingCurve`:
   *
   *   - pump.fun bonding-curve tokens \u2192 /api/pumpfun/sell (pump.fun program)
   *   - everything else (AMM tokens, graduated pump.fun) \u2192 Jupiter aggregator
   *     (swap token\u2192SOL)
   *
   * Both paths end the same way: wallet signs (browser popup) \u2192 submit \u2192
   * confirm. The private key never touches this module or the server.
   *
   * For pump.fun sells, if `tokenAmountRaw` is omitted the server sells the
   * user's full ATA balance. For Jupiter sells, the caller must provide
   * `tokenAmountRaw` (Jupiter needs an exact input amount for the quote).
   */
  const executeLiveSell = useCallback(
    async (params: LiveSellParams): Promise<LiveSellResult> => {
      if (!effectivePublicKey || !effectiveSignTransaction) {
        throw new JupiterError("No signing wallet — connect one or arm the Sniper Signer", "quote");
      }

      // --- Pump.fun bonding-curve sell path ---
      if (params.isPumpFunBondingCurve) {
        const result = await executePumpFunSell(
          {
            mint: params.mint,
            slippageBps: params.slippageBps,
            priorityFeeLamports: params.priorityFeeLamports,
            tokenAmountRaw: params.tokenAmountRaw,
          },
          connection,
          effectivePublicKey,
          effectiveSignTransaction,
        );
        return {
          signature: result.signature,
          tokensSold: result.tokensSold,
          solReceived: result.solReceived,
          priceImpactPct: result.priceImpactPct,
        };
      }

      // --- Jupiter sell path (AMM tokens, graduated pump.fun, Raydium, etc.) ---
      // Jupiter swap: inputMint = token, outputMint = SOL.
      // Full-exit sells resolve the wallet's ACTUAL token balance so the
      // exit never tries to sell more tokens than the buy actually filled
      // (entry-time expected amounts are stale the moment price moves).
      let tokenAmountRaw = params.tokenAmountRaw;
      if (!tokenAmountRaw) {
        try {
          tokenAmountRaw = await resolveTokenBalance(connection, effectivePublicKey, params.mint);
        } catch (e) {
          throw new JupiterError(
            `Could not read token balance for ${params.mint.slice(0, 8)}…: ${
              e instanceof Error ? e.message : String(e)
            }`,
            "quote",
          );
        }
      }
      if (!tokenAmountRaw || tokenAmountRaw === "0") {
        throw new JupiterError(
          `Token balance for ${params.mint.slice(0, 8)}… is zero — nothing to sell`,
          "quote",
        );
      }
      const quote = await getQuote({
        inputMint: params.mint,
        outputMint: SOL_MINT,
        amountLamports: tokenAmountRaw,
        slippageBps: params.slippageBps,
      });

      assertSafePriceImpact(quote, params.maxPriceImpactPct);

      const swapTxBase64 = await buildSwapTransaction({
        quote,
        userPublicKey: effectivePublicKey.toBase58(),
        priorityFeeLamports: params.priorityFeeLamports,
      });

      const tx = VersionedTransaction.deserialize(
        Uint8Array.from(atob(swapTxBase64), (c) => c.charCodeAt(0)),
      );

      let signed: VersionedTransaction;
      try {
        signed = await effectiveSignTransaction(tx);
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
        throw new JupiterError(
          `Submitted (sig ${signature}) but confirmation failed: ${
            e instanceof Error ? e.message : String(e)
          }`,
          "confirm",
        );
      }

      return {
        signature,
        tokensSold: quote.inAmount,
        solReceived: quote.outAmount,
        priceImpactPct: quote.priceImpactPct,
      };
    },
    [connection, effectivePublicKey, effectiveSignTransaction],
  );

  /**
   * Batch-sells several live positions in ONE wallet approval.
   *
   * Used by the auto-exit executor when `safetyFilters.walletAutoApprove`
   * is on and several positions are flagged for exit at once: every AMM
   * (Jupiter) sell transaction is built first, then they are ALL signed
   * with a single signAllTransactions call — one approval for the whole
   * burst instead of one popup per position. Browser wallets still require
   * that single approval (a dApp cannot auto-approve an extension wallet);
   * the Sniper Signer is the only fully popup-free path.
   *
   * Pump.fun bonding-curve sells are built server-side one at a time, so
   * they are signed sequentially through the single-sell path (a separate
   * approval each). Results are returned in the same order as `batch`.
   */
  const executeLiveSells = useCallback(
    async (batch: LiveSellParams[]): Promise<LiveSellResult[]> => {
      if (!effectivePublicKey || !effectiveSignTransaction) {
        throw new JupiterError("No signing wallet — connect one or arm the Sniper Signer", "quote");
      }
      const results: (LiveSellResult | undefined)[] = batch.map(() => undefined);

      // 1) Pump.fun bonding-curve sells — sequential (server-built txs).
      for (let i = 0; i < batch.length; i++) {
        if (!batch[i].isPumpFunBondingCurve) continue;
        results[i] = await executeLiveSell(batch[i]);
      }

      // 2) AMM (Jupiter) sells — build all, sign as one batch, submit each.
      const ammIndices = batch
        .map((p, i) => (p.isPumpFunBondingCurve ? -1 : i))
        .filter((i) => i >= 0);
      if (ammIndices.length) {
        const built: Array<{ tx: VersionedTransaction; quote: JupiterQuote }> = [];
        for (const i of ammIndices) {
          const params = batch[i];
          // Full-exit sells resolve the wallet's ACTUAL token balance so
          // the batch never tries to sell more tokens than the buys filled.
          let tokenAmountRaw = params.tokenAmountRaw;
          if (!tokenAmountRaw) {
            try {
              tokenAmountRaw = await resolveTokenBalance(
                connection,
                effectivePublicKey,
                params.mint,
              );
            } catch (e) {
              throw new JupiterError(
                `Could not read token balance for ${params.mint.slice(0, 8)}…: ${
                  e instanceof Error ? e.message : String(e)
                }`,
                "quote",
              );
            }
          }
          if (!tokenAmountRaw || tokenAmountRaw === "0") {
            throw new JupiterError(
              `Token balance for ${params.mint.slice(0, 8)}… is zero — nothing to sell`,
              "quote",
            );
          }
          const quote = await getQuote({
            inputMint: params.mint,
            outputMint: SOL_MINT,
            amountLamports: tokenAmountRaw,
            slippageBps: params.slippageBps,
          });
          assertSafePriceImpact(quote, params.maxPriceImpactPct);
          const swapTxBase64 = await buildSwapTransaction({
            quote,
            userPublicKey: effectivePublicKey.toBase58(),
            priorityFeeLamports: params.priorityFeeLamports,
          });
          const tx = VersionedTransaction.deserialize(
            Uint8Array.from(atob(swapTxBase64), (c) => c.charCodeAt(0)),
          );
          built.push({ tx, quote });
        }

        // ONE wallet approval for the whole burst. If the wallet adapter
        // lacks signAllTransactions, fall back to per-transaction signing.
        let signed: VersionedTransaction[];
        if (effectiveSignAllTransactions) {
          try {
            signed = await effectiveSignAllTransactions(built.map((b) => b.tx));
          } catch (e) {
            throw new JupiterError(
              e instanceof Error ? e.message : "User rejected or wallet error",
              "swap",
            );
          }
        } else {
          signed = [];
          for (const b of built) signed.push(await effectiveSignTransaction(b.tx));
        }

        for (let k = 0; k < built.length; k++) {
          const { tx, quote } = built[k];
          const idx = ammIndices[k];
          let signature: string;
          try {
            signature = await connection.sendRawTransaction(signed[k].serialize(), {
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
            throw new JupiterError(
              `Submitted (sig ${signature}) but confirmation failed: ${
                e instanceof Error ? e.message : String(e)
              }`,
              "confirm",
            );
          }
          results[idx] = {
            signature,
            tokensSold: quote.inAmount,
            solReceived: quote.outAmount,
            priceImpactPct: quote.priceImpactPct,
          };
        }
      }
      return results as LiveSellResult[];
    },
    [
      connection,
      effectivePublicKey,
      effectiveSignTransaction,
      effectiveSignAllTransactions,
      executeLiveSell,
    ],
  );

  /**
   * Batch-entry path: builds all swap transactions (Jupiter + pump.fun),
   * signs them ALL in one wallet approval (signAllTransactions), then
   * sends + confirms each. Used by useAutoExecutor when walletAutoApprove
   * is on and the Sniper Signer is NOT armed — one popup for the whole
   * entry burst instead of one per position.
   */
  const executeBatchSwaps = useCallback(
    async (batch: LiveSwapParams[]): Promise<LiveSwapResult[]> => {
      if (!effectivePublicKey || !effectiveSignTransaction) {
        throw new JupiterError("No signing wallet — connect one or arm the Sniper Signer", "quote");
      }
      const results: (LiveSwapResult | undefined)[] = batch.map(() => undefined);

      // 1) Build all transactions — pump.fun ones need the server, Jupiter ones need quote+build.
      const built: Array<{
        tx: VersionedTransaction;
        idx: number;
        quote?: JupiterQuote;
      }> = [];

      for (let i = 0; i < batch.length; i++) {
        const params = batch[i];
        try {
          if (params.isPumpFunBondingCurve) {
            const { tx } = await buildPumpFunBuyTransaction(
              {
                mint: params.outputMint,
                amountLamports: params.amountLamports,
                slippageBps: params.slippageBps,
                priorityFeeLamports: params.priorityFeeLamports,
              },
              effectivePublicKey,
            );
            built.push({ tx, idx: i });
          } else {
            const quote = await getQuote({
              inputMint: params.inputMint,
              outputMint: params.outputMint,
              amountLamports: params.amountLamports,
              slippageBps: params.slippageBps,
            });
            assertSafePriceImpact(quote, params.maxPriceImpactPct);
            const swapTxBase64 = await buildSwapTransaction({
              quote,
              userPublicKey: effectivePublicKey.toBase58(),
              priorityFeeLamports: params.priorityFeeLamports,
            });
            const tx = VersionedTransaction.deserialize(
              Uint8Array.from(atob(swapTxBase64), (c) => c.charCodeAt(0)),
            );
            built.push({ tx, idx: i, quote });
          }
        } catch (e) {
          throw new JupiterError(
            `Batch build failed for entry #${i + 1}: ${e instanceof Error ? e.message : String(e)}`,
            "quote",
          );
        }
      }

      if (!built.length) return [] as LiveSwapResult[];

      // 2) Sign all transactions in ONE wallet approval.
      let signed: VersionedTransaction[];
      if (effectiveSignAllTransactions) {
        try {
          signed = await effectiveSignAllTransactions(built.map((b) => b.tx));
        } catch (e) {
          throw new JupiterError(
            e instanceof Error ? e.message : "User rejected or wallet error",
            "swap",
          );
        }
      } else {
        signed = [];
        for (const b of built) signed.push(await effectiveSignTransaction(b.tx));
      }

      // 3) Send + confirm each signed transaction.
      for (let k = 0; k < built.length; k++) {
        const { idx } = built[k];
        const params = batch[idx];
        let signature: string;
        try {
          signature = await connection.sendRawTransaction(signed[k].serialize(), {
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
          throw new JupiterError(
            `Submitted (sig ${signature}) but confirmation failed: ${
              e instanceof Error ? e.message : String(e)
            }`,
            "confirm",
          );
        }
        results[idx] = {
          signature,
          inAmount: String(params.amountLamports),
          outAmount: built[k].quote?.outAmount ?? "0",
          priceImpactPct: built[k].quote?.priceImpactPct ?? "0",
        };
      }
      return results as LiveSwapResult[];
    },
    [
      connection,
      effectivePublicKey,
      effectiveSignTransaction,
      effectiveSignAllTransactions,
    ],
  );

  return {
    executeSwap,
    executeLiveSell,
    executeLiveSells,
    executeBatchSwaps,
    walletReady: ready,
  };
}
