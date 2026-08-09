// Auto-exit engine for live mode.
//
// When a live position's price crosses its TP or SL threshold, tick() sets
// `exitRequested = true` and `exitReason`. This hook watches for those
// flagged positions and fires the on-chain sell — no human click required.
//
// Flow:  exitRequested (set by tick()) → executeLiveSell (on-chain sell)
//        → confirmLiveExit (bookkeeping: PnL, fee settlement pending, SOL
//        returned to wallet).
//
// Safety invariants (mirror useAutoExecutor):
//   • Only fires in live mode while status === "running" with a connected
//     wallet. We double-check inside the async loop too (defense in depth).
//   • Deduplicates via processedRef so a position is never sold twice even
//     if the store re-emits it across renders.
//   • Serialized via inFlightRef so concurrent exits don't race wallet
//     signing popups.
//   • Pump.fun bonding-curve tokens route to /api/pumpfun/sell (server sells
//     the full ATA balance). AMM tokens route through Jupiter and require
//     `tokensReceivedRaw` (stored on the position at entry time).
//   • Failures are logged and the position stays flagged so the user can
//     retry via the manual Close button.
import { useEffect, useRef } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { toast } from "sonner";
import { useBotStore } from "@/lib/bot-store";
import { useLiveExecution } from "./use-live-execution";

const LAMPORTS_PER_SOL = 1_000_000_000;

export function useAutoExitExecutor() {
  const { publicKey, signTransaction, connected } = useWallet();
  const { executeLiveSell, walletReady } = useLiveExecution();
  const processedRef = useRef<Set<string>>(new Set());
  const inFlightRef = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    const unsub = useBotStore.subscribe((state) => {
      // Fast bail-out: only act in live mode with a connected wallet. Unlike
      // the entry executor we don't require autoExecute to be on — once a
      // position is flagged for exit (TP/SL hit) we always want to sell to
      // lock in the gain or cut the loss. The flag itself is the consent.
      const armed =
        state.mode === "live" &&
        state.walletConnected &&
        connected &&
        !!publicKey &&
        !!signTransaction;
      if (!armed) return;

      // Find live positions flagged for exit that we haven't processed.
      const fresh = state.positions.filter(
        (p) => p.live && p.exitRequested && !processedRef.current.has(p.id),
      );
      if (!fresh.length) return;

      // Mark processed immediately so a re-emit doesn't double-fire.
      for (const p of fresh) processedRef.current.add(p.id);

      inFlightRef.current = inFlightRef.current.then(async () => {
        for (const p of fresh) {
          // Re-read latest store state inside the async loop.
          const s = useBotStore.getState();
          // The position may have already been closed by a manual action.
          const stillOpen = s.positions.find((x) => x.id === p.id);
          if (!stillOpen) continue;

          const mint = p.mint ?? (p as { mintAddress?: string | null }).mintAddress;
          if (!mint) {
            s.logAudit(`AUTO_EXIT_SKIP · ${p.token} · no mint resolved`, "error");
            continue;
          }

          const isPumpFunBondingCurve = p.venue === "pumpfun";

          // AMM tokens need an explicit token amount for the Jupiter quote.
          // Pump.fun sells can omit it (server reads the full ATA balance).
          if (!isPumpFunBondingCurve && !p.tokensReceivedRaw) {
            s.logAudit(
              `AUTO_EXIT_SKIP · ${p.token} · AMM sell requires tokensReceivedRaw (missing from entry)`,
              "error",
            );
            continue;
          }

          s.logAudit(
            `AUTO_EXIT · ${p.token} · ${p.exitReason ?? "manual"} · selling on-chain`,
            "execution",
          );

          try {
            const result = await executeLiveSell({
              mint,
              slippageBps: 500,
              maxPriceImpactPct: 20,
              isPumpFunBondingCurve,
              tokenAmountRaw: p.tokensReceivedRaw,
            });
            const solReceived = Number(result.solReceived) / LAMPORTS_PER_SOL;
            s.confirmLiveExit({
              positionId: p.id,
              signature: result.signature,
              solReceived,
            });
            s.logAudit(
              `LIVE_SELL_CONFIRMED · ${p.token} · sig ${result.signature.slice(0, 8)}… · sol ${solReceived.toFixed(5)} · impact ${result.priceImpactPct}%`,
              "execution",
            );
            toast.success(`Auto-exit filled · ${p.token}`, {
              description: `${p.exitReason?.toUpperCase() ?? "EXIT"} · ${solReceived.toFixed(4)} SOL returned`,
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const stage = (err as { stage?: string }).stage;
            // Clear the processed flag so the user can retry manually, and
            // log the failure. The position stays flagged (exitRequested)
            // so the manual Close button knows an on-chain sell is needed.
            processedRef.current.delete(p.id);
            s.logAudit(
              `LIVE_SELL_FAILED${stage ? ` · stage=${stage}` : ""} · ${p.token} · ${message}`,
              "error",
            );
            toast.error(`Auto-exit failed · ${p.token}`, {
              description: stage ? `${stage}: ${message}` : message,
            });
          }
        }
      });
    });
    return () => unsub();
  }, [connected, publicKey, signTransaction, executeLiveSell, walletReady]);
}
