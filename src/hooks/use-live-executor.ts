// Wires the bot's Live-mode exits to real on-chain execution via Jupiter,
// and routes the platform fee to PLATFORM_FEE_WALLET when the trade is
// profitable. Paper mode is untouched.
//
// Profit audit trail:
//   1. The store records the closed trade with pnl / fee / net-to-user and
//      settlementStatus = "pending" for profitable live exits (or "n/a").
//   2. This hook attempts the on-chain fee transfer, then patches the trade
//      row via setTradeSettlement("settled" | "failed", feeTxSig).
//   3. Every state change appends an explicit `audit`/`error` log line so
//      the pre- and post-settlement state is auditable end-to-end.
//
// The user's SOL never leaves the wallet during simulated entries — only
// the platform fee is settled on-chain, and only on profitable exits.
import { useEffect, useRef } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useServerFn } from "@tanstack/react-start";
import { useBotStore } from "@/lib/bot-store";
import { executeSwap, sendSolTransfer, SOL_MINT } from "@/lib/jupiter-client";
import { updateTradeSettlement } from "@/lib/persistence.functions";
import { supabase } from "@/integrations/supabase/client";
import { computeBackoff } from "@/lib/retry-backoff";

const MIN_FEE_LAMPORTS = 1_000; // dust guard: below this, skip the transfer
// Reconciliation tolerance: observed delta may differ from expected by up to
// ~0.0005 SOL to accommodate Solana base tx fee (~5000 lamports) + priority tip.
const RECONCILE_TOLERANCE_LAMPORTS = 500_000;
const CONFIRM_TIMEOUT_MS = 30_000;
const MAX_SETTLE_ATTEMPTS = 4;

/** Permanent errors — user rejected, insufficient funds, etc. — don't retry. */
function isPermanentError(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("user reject") ||
    m.includes("rejected the request") ||
    m.includes("insufficient") ||
    m.includes("unauthorized") ||
    m.includes("invalid public key") ||
    m.includes("invalid address")
  );
}

/** Ask the RPC if a signature is already confirmed/finalized. Used to detect
 *  a prior in-flight send so retries never double-charge. */
async function isSignatureConfirmed(
  connection: import("@solana/web3.js").Connection,
  sig: string,
): Promise<boolean> {
  try {
    const st = await connection.getSignatureStatus(sig, {
      searchTransactionHistory: true,
    });
    const s = st?.value?.confirmationStatus;
    return s === "confirmed" || s === "finalized";
  } catch {
    return false;
  }
}

async function getBalanceLamports(
  connection: import("@solana/web3.js").Connection,
  pk: import("@solana/web3.js").PublicKey,
): Promise<number | null> {
  try {
    return await connection.getBalance(pk, "confirmed");
  } catch {
    return null;
  }
}

export function useLiveExecutor() {
  const { connection } = useConnection();
  const { wallet, publicKey } = useWallet();
  const patchSettlement = useServerFn(updateTradeSettlement);
  const processedRef = useRef<Set<string>>(new Set());
  const inFlightRef = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    const adapter = wallet?.adapter;
    if (!adapter || !publicKey) return;
    let cancelled = false;

    // Seed processed with any already-terminal rows so we don't retroactively
    // settle rehydrated history.
    const seed = useBotStore.getState().tradeHistory;
    for (const t of seed) {
      if (t.settlementStatus !== "pending") processedRef.current.add(t.id);
    }

    const persistSettlement = async (
      tradeId: string,
      status: "settled" | "failed",
      feeTxSig?: string,
    ) => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!data.session?.access_token) return; // signed out; local audit only
        await patchSettlement({
          data: {
            client_id: tradeId,
            settlement_status: status,
            fee_tx_sig: feeTxSig ?? null,
          },
        });
      } catch {
        /* persistence best-effort; local audit already recorded */
      }
    };

    const unsub = useBotStore.subscribe((state) => {
      if (cancelled) return;
      if (state.mode !== "live") return;

      const fresh = state.tradeHistory.filter(
        (t) =>
          !processedRef.current.has(t.id) &&
          t.mode === "live" &&
          t.settlementStatus === "pending" &&
          t.pnlSol > 0 &&
          t.feePaidSol > 0 &&
          !!t.feeWallet,
      );
      if (!fresh.length) return;
      for (const t of fresh) processedRef.current.add(t.id);

      inFlightRef.current = inFlightRef.current.then(async () => {
        for (const t of fresh) {
          const lamports = Math.floor(t.feePaidSol * 1e9);
          const setSettlement = useBotStore.getState().setTradeSettlement;

          if (lamports < MIN_FEE_LAMPORTS) {
            setSettlement(t.id, {
              status: "settled",
              error: "dust; skipped on-chain transfer",
            });
            await persistSettlement(t.id, "settled");
            continue;
          }
          if (t.feeWallet && publicKey.toBase58() === t.feeWallet) {
            setSettlement(t.id, {
              status: "settled",
              error: "user wallet == fee wallet; no-op",
            });
            await persistSettlement(t.id, "settled");
            continue;
          }
          const logAudit = useBotStore.getState().logAudit;
          const shortId = t.id.slice(0, 6);

          // If a prior attempt already broadcast a signature, check the chain
          // FIRST — a network blip after send would otherwise re-charge.
          if (t.feeTxSig) {
            const already = await isSignatureConfirmed(connection, t.feeTxSig);
            if (already) {
              logAudit(
                `Retry#${shortId} skipped — prior signature ${t.feeTxSig.slice(0, 8)}… already confirmed`,
                "audit",
              );
              setSettlement(t.id, { status: "settled", feeTxSig: t.feeTxSig });
              await persistSettlement(t.id, "settled", t.feeTxSig);
              continue;
            }
          }

          // 1. Pre-settlement balance snapshot.
          const beforeLamports = await getBalanceLamports(connection, publicKey);
          if (beforeLamports != null) {
            logAudit(
              `Reconcile#${shortId} pre-settlement balance ${(beforeLamports / 1e9).toFixed(6)} SOL`,
              "audit",
            );
          }

          let sig: string | null = null;
          let lastError: string | undefined;

          // 2. Retry loop with exponential backoff.
          for (let attempt = 0; attempt < MAX_SETTLE_ATTEMPTS; attempt++) {
            try {
              sig = await sendSolTransfer({
                connection,
                wallet: adapter,
                toAddress: t.feeWallet as string,
                lamports,
              });
              break; // success — proceed to confirm
            } catch (e) {
              lastError = (e as Error).message ?? "unknown error";
              const permanent = isPermanentError(lastError);
              logAudit(
                `Retry#${shortId} attempt ${attempt + 1}/${MAX_SETTLE_ATTEMPTS} failed · ${lastError}${permanent ? " (permanent)" : ""}`,
                "error",
              );
              if (permanent || attempt === MAX_SETTLE_ATTEMPTS - 1) break;
              await new Promise((r) =>
                setTimeout(r, computeBackoff(attempt, { baseMs: 800, maxMs: 8_000 })),
              );
            }
          }

          // 2a. All send attempts failed → ROLLBACK accounting so the user is
          // credited for the fee they were never actually charged.
          if (!sig) {
            useBotStore.getState().rollbackTradeFee(t.id, lastError ?? "unknown send error");
            await persistSettlement(t.id, "failed");
            continue;
          }

          // 3. Confirm on-chain before sampling post-balance.
          try {
            const { blockhash, lastValidBlockHeight } =
              await connection.getLatestBlockhash("confirmed");
            await Promise.race([
              connection.confirmTransaction(
                { signature: sig, blockhash, lastValidBlockHeight },
                "confirmed",
              ),
              new Promise((_r, rej) =>
                setTimeout(() => rej(new Error("confirm timeout")), CONFIRM_TIMEOUT_MS),
              ),
            ]);
          } catch (ce) {
            logAudit(
              `Reconcile#${shortId} confirm slow/failed (${(ce as Error).message}); sampling anyway`,
              "audit",
            );
          }

          // 4. Post-settlement balance snapshot + delta check.
          const afterLamports = await getBalanceLamports(connection, publicKey);
          let reconcileNote: string | undefined;
          if (beforeLamports != null && afterLamports != null) {
            const observedDelta = beforeLamports - afterLamports;
            const drift = Math.abs(observedDelta - lamports);
            const ok = drift <= RECONCILE_TOLERANCE_LAMPORTS;
            logAudit(
              `Reconcile#${shortId} post ${(afterLamports / 1e9).toFixed(6)} SOL · out ${(observedDelta / 1e9).toFixed(6)} · expected ${(lamports / 1e9).toFixed(6)} · drift ${drift} lamports · ${ok ? "OK" : "MISMATCH"}`,
              ok ? "audit" : "error",
            );
            if (!ok) reconcileNote = `reconcile mismatch: drift ${drift} lamports`;
            logAudit(
              `Reconcile#${shortId} net-to-user retained ${t.netToUserSol.toFixed(6)} SOL in wallet ${publicKey.toBase58().slice(0, 6)}…`,
              "audit",
            );
          } else {
            logAudit(
              `Reconcile#${shortId} balance snapshot unavailable; skipped delta check`,
              "audit",
            );
          }

          setSettlement(t.id, {
            status: "settled",
            feeTxSig: sig,
            error: reconcileNote,
          });
          await persistSettlement(t.id, "settled", sig);
        }
      });
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [connection, wallet, publicKey, patchSettlement]);
}

// Re-export helpers so components can call ad-hoc quotes.
export { executeSwap, SOL_MINT };
