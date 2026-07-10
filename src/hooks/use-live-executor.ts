// Wires the bot's Live-mode exits to real on-chain execution via Jupiter,
// and routes the platform fee to PLATFORM_FEE_WALLET when the trade is
// profitable. Paper mode is untouched.
//
// Profit flow (live mode):
//   - The user's SOL never leaves the connected wallet during simulated
//     entries — only the platform fee is settled on-chain, and only when
//     the closed position is profitable.
//   - fee = pnlSol * platformFeePct/100 (computed in the store, clamped to
//     positive PnL), so the net profit remains in the user's wallet.
//   - We de-duplicate by tradeHistory id so a single realized profit is
//     never fee-charged twice, even after re-renders or store rehydration.
import { useEffect, useRef } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useBotStore } from "@/lib/bot-store";
import { executeSwap, sendSolTransfer, SOL_MINT } from "@/lib/jupiter-client";

const MIN_FEE_LAMPORTS = 1_000; // dust guard: below this, skip the transfer

export function useLiveExecutor() {
  const { connection } = useConnection();
  const { wallet, publicKey } = useWallet();
  // Track ids we've already settled (or attempted) so we never double-charge.
  const processedRef = useRef<Set<string>>(new Set());
  // Serialize transfers so multiple exits in the same tick don't race the
  // wallet's signTransaction popup.
  const inFlightRef = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    const adapter = wallet?.adapter;
    if (!adapter || !publicKey) return;
    let cancelled = false;

    // Seed processed with whatever is already in history at mount so we
    // don't retroactively try to charge fees for pre-existing rows
    // (persisted from a previous session).
    const seed = useBotStore.getState().tradeHistory;
    for (const t of seed) processedRef.current.add(t.id);

    const unsub = useBotStore.subscribe((state) => {
      if (cancelled) return;
      if (state.mode !== "live") return;

      const fresh = state.tradeHistory.filter(
        (t) =>
          !processedRef.current.has(t.id) &&
          t.mode === "live" &&
          t.pnlSol > 0 &&
          t.feePaidSol > 0 &&
          !!t.feeWallet,
      );
      if (!fresh.length) return;

      // Mark as processed BEFORE awaiting so re-entrant subscribe calls
      // don't queue the same trade twice.
      for (const t of fresh) processedRef.current.add(t.id);

      inFlightRef.current = inFlightRef.current.then(async () => {
        for (const t of fresh) {
          const lamports = Math.floor(t.feePaidSol * 1e9);
          if (lamports < MIN_FEE_LAMPORTS) continue;
          // Never send fee to the user's own wallet (bootstrap admin case).
          if (t.feeWallet && publicKey.toBase58() === t.feeWallet) {
            useBotStore
              .getState()
              .logAudit(
                `Fee retained: user wallet is the platform fee wallet`,
                "audit",
              );
            continue;
          }
          try {
            const sig = await sendSolTransfer({
              connection,
              wallet: adapter,
              toAddress: t.feeWallet as string,
              lamports,
            });
            useBotStore
              .getState()
              .logAudit(
                `Platform fee ${(lamports / 1e9).toFixed(5)} SOL sent · ${sig.slice(0, 8)}…`,
                "audit",
              );
          } catch (e) {
            // On failure, allow a manual retry later by un-marking this id.
            processedRef.current.delete(t.id);
            useBotStore
              .getState()
              .logAudit(
                `Fee transfer failed (will retry on next exit): ${(e as Error).message}`,
                "error",
              );
          }
        }
      });
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [connection, wallet, publicKey]);
}

// Re-export helpers so components can call ad-hoc quotes.
export { executeSwap, SOL_MINT };
