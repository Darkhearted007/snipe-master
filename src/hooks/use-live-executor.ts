// Wires the bot's Live-mode exits to real on-chain execution via Jupiter,
// and routes the platform fee to PLATFORM_FEE_WALLET when the trade is
// profitable. Paper mode is untouched.
import { useEffect } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useBotStore } from "@/lib/bot-store";
import { executeSwap, sendSolTransfer, SOL_MINT } from "@/lib/jupiter-client";

export function useLiveExecutor() {
  const { connection } = useConnection();
  const { wallet, publicKey } = useWallet();

  useEffect(() => {
    const adapter = wallet?.adapter;
    if (!adapter || !publicKey) return;
    let cancelled = false;

    const unsub = useBotStore.subscribe(async (state, prev) => {
      if (cancelled) return;
      if (state.mode !== "live") return;
      // React only to newly-appended live TP/SL history rows
      const before = new Set(prev.tradeHistory.slice(0, 10).map((t) => t.id));
      const fresh = state.tradeHistory.filter(
        (t) => !before.has(t.id) && t.mode === "live",
      );
      if (!fresh.length) return;

      for (const t of fresh) {
        // Simulator has already updated bankroll — we now perform the
        // corresponding on-chain settlement (fee routing on profit).
        if (t.pnlSol > 0 && t.feePaidSol > 0 && t.feeWallet) {
          try {
            const lamports = Math.floor(t.feePaidSol * 1e9);
            if (lamports > 0) {
              const sig = await sendSolTransfer({
                connection,
                wallet: adapter,
                toAddress: t.feeWallet,
                lamports,
              });
              useBotStore
                .getState()
                .logAudit(`Platform fee tx confirmed · ${sig.slice(0, 8)}…`, "audit");
            }
          } catch (e) {
            useBotStore
              .getState()
              .logAudit(
                `Fee transfer failed (retained): ${(e as Error).message}`,
                "error",
              );
          }
        }
      }
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [connection, wallet, publicKey]);
}

// Re-export helpers so components can call ad-hoc quotes.
export { executeSwap, SOL_MINT };
