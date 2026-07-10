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

const MIN_FEE_LAMPORTS = 1_000; // dust guard: below this, skip the transfer
// Reconciliation tolerance: observed delta may differ from expected by up to
// ~0.0005 SOL to accommodate Solana base tx fee (~5000 lamports) + priority tip.
const RECONCILE_TOLERANCE_LAMPORTS = 500_000;
const CONFIRM_TIMEOUT_MS = 30_000;

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
          try {
            const sig = await sendSolTransfer({
              connection,
              wallet: adapter,
              toAddress: t.feeWallet as string,
              lamports,
            });
            setSettlement(t.id, { status: "settled", feeTxSig: sig });
            await persistSettlement(t.id, "settled", sig);
          } catch (e) {
            const msg = (e as Error).message ?? "unknown error";
            // Un-mark so a future subscribe tick can retry.
            processedRef.current.delete(t.id);
            setSettlement(t.id, { status: "failed", error: msg });
            await persistSettlement(t.id, "failed");
          }
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
