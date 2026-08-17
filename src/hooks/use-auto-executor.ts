// Auto-execution engine for live mode.
//
// When `safetyFilters.autoExecute` is on (live mode + running + wallet
// connected + live-confirmed), this hook watches the opportunity feed for
// entries that pass all safety gates (decision="enter") and fires the same
// requestLiveEntry → executeSwap → confirmLiveEntry path the manual Execute
// button uses — no human click required.
//
// Safety invariants preserved:
//   • Only fires in live mode while status === "running" (tick() already
//     guards this, but we double-check — defense in depth).
//   • Uses checkLiveEntry (pure) as a pre-gate before requestLiveEntry
//     (which writes the ENTRY_REQUESTED log). This mirrors the manual
//     button's two-phase check so a stale render never triggers a swap.
//   • Deduplicates via a processedRef Set so an opportunity is never
//     executed twice even if the store re-emits it across renders.
//   • Failures are logged via failLiveEntry + logAudit, never crash the loop.
//   • Serialized via inFlightRef so concurrent opportunities don't race
//     wallet signing popups (the adapter only handles one sign at a time).
import { useEffect, useRef } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { toast } from "sonner";
import { useBotStore } from "@/lib/bot-store";
import { useLiveExecution } from "./use-live-execution";
import { useSniperSigner } from "@/components/sniper-signer-provider";
import { SOL_MINT } from "@/lib/jupiter";

const LAMPORTS_PER_SOL = 1_000_000_000;

export function useAutoExecutor() {
  const { publicKey, signTransaction, connected } = useWallet();
  const { signer: sniper } = useSniperSigner();
  const { executeSwap, executeBatchSwaps, walletReady } = useLiveExecution();
  const processedRef = useRef<Set<string>>(new Set());
  const inFlightRef = useRef<Promise<unknown>>(Promise.resolve());
  const enabledRef = useRef(false);

  // The Sniper Signer (burner key) counts as a signing wallet with no
  // popups; otherwise the browser wallet extension must be connected.
  const canSign = sniper ? true : !!(connected && publicKey && signTransaction);
  // When the browser wallet is the signing path (no Sniper Signer),
  // walletAutoApprove batches multiple entries into ONE signAllTransactions
  // call so the user sees a single approval popup for the burst.
  const useBatchEntry = !sniper && canSign;

  useEffect(() => {
    const unsub = useBotStore.subscribe((state) => {
      // Fast bail-out: only act when auto-execute is armed and the bot is
      // actively running in live mode with a connected wallet. This keeps
      // the subscriber cheap on every store update in paper mode.
      const armed =
        state.mode === "live" &&
        state.status === "running" &&
        state.safetyFilters.autoExecute &&
        state.liveConfirmed &&
        state.walletConnected &&
        canSign;
      enabledRef.current = armed;
      if (!armed) return;

      // Find enter-decision opportunities we haven't processed yet.
      const fresh = state.opportunities.filter(
        (o) =>
          o.decision === "enter" && (o.mint || o.tokenAddress) && !processedRef.current.has(o.id),
      );
      if (!fresh.length) return;

      // Mark them processed immediately so a re-emit doesn't double-fire.
      for (const o of fresh) processedRef.current.add(o.id);

      inFlightRef.current = inFlightRef.current.then(async () => {
        // ------------------------------------------------------------------
        // Wallet auto-approve (batch entries): when the browser wallet is
        // the signing path (no Sniper Signer), walletAutoApprove is on,
        // and several entries arrive at once, build every swap transaction
        // and sign them ALL in one wallet approval — one popup for the
        // burst instead of one per position. A single entry still uses the
        // sequential path below (one approval either way).
        // ------------------------------------------------------------------
        const s0 = useBotStore.getState();
        if (
          s0.safetyFilters.walletAutoApprove &&
          fresh.length >= 2 &&
          useBatchEntry
        ) {
          // Phase 1+2: gate + commit every opportunity before building txs.
          const valid: Array<{
            opp: (typeof fresh)[number];
            sizeSol: number;
            amountLamports: number;
            isPumpFunBondingCurve: boolean;
            outputMint: string;
          }> = [];
          for (const opp of fresh) {
            const s = useBotStore.getState();
            if (s.status !== "running" || s.guardrailBreached) continue;
            const gate = s.checkLiveEntry(opp.id);
            if (!gate.ok) {
              s.logAudit(`AUTO_SKIP · ${opp.token} · ${gate.error}`, "safety");
              continue;
            }
            const committed = s.requestLiveEntry(opp.id);
            if (!committed.ok) {
              s.logAudit(`AUTO_SKIP · ${opp.token} · ${committed.error}`, "safety");
              continue;
            }
            const outputMint = opp.mint ?? opp.tokenAddress ?? null;
            if (!outputMint) {
              s.logAudit(`AUTO_SKIP · ${opp.token} · no mint resolved`, "safety");
              continue;
            }
            const amountLamports = Math.max(1, Math.floor(committed.sizeSol * LAMPORTS_PER_SOL));
            const isPumpFunBondingCurve = opp.venue === "pumpfun";
            s.logAudit(
              `AUTO_ENTRY · ${opp.token} · size ${committed.sizeSol.toFixed(5)} SOL · score ${opp.safetyScore ?? opp.score ?? opp.safety}`,
              "execution",
            );
            valid.push({ opp, sizeSol: committed.sizeSol, amountLamports, isPumpFunBondingCurve, outputMint });
          }
          if (!valid.length) return;

          try {
            const results = await executeBatchSwaps(
              valid.map((v) => ({
                inputMint: SOL_MINT,
                outputMint: v.outputMint,
                amountLamports: v.amountLamports,
                slippageBps: 300,
                maxPriceImpactPct: 15,
                isPumpFunBondingCurve: v.isPumpFunBondingCurve,
              })),
            );
            const cur = useBotStore.getState();
            for (let i = 0; i < valid.length; i++) {
              const { opp, sizeSol } = valid[i];
              const r = results[i];
              cur.confirmLiveEntry({
                opportunityId: opp.id,
                sizeSol,
                signature: r.signature,
                tokensReceivedRaw: r.outAmount,
              });
              cur.logAudit(
                `LIVE_SWAP_CONFIRMED · ${opp.token} · in ${valid[i].amountLamports} lamports · out ${r.outAmount} · impact ${r.priceImpactPct}%`,
                "execution",
              );
              toast.success(`Auto-entry filled · ${opp.token}`, {
                description: `${sizeSol.toFixed(4)} SOL · score ${opp.safetyScore ?? opp.score ?? opp.safety}`,
              });
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const stage = (err as { stage?: string }).stage;
            // Clear processed markers so a re-emit retries the batch.
            for (const { opp } of valid) processedRef.current.delete(opp.id);
            s0.logAudit(
              `AUTO_ENTRY_BATCH_FAILED${stage ? ` · stage=${stage}` : ""} · ${valid.length} entry(ies) · ${message}`,
              "error",
            );
            for (const { opp, sizeSol } of valid) {
              s0.failLiveEntry({ opportunityId: opp.id, reason: message });
            }
            toast.error(`Auto-entry batch failed`, {
              description: stage ? `${stage}: ${message}` : message,
            });
          }
          return;
        }

        // --- Sequential path (single entry or batch not enabled) ----------
        for (const opp of fresh) {
          // Re-read latest store state inside the async loop — the
          // bankroll/guardrail may have moved since we snapshotted.
          const s = useBotStore.getState();
          if (s.status !== "running" || s.guardrailBreached) continue;

          // Phase 1: pure gate (no side effects). Re-check because state
          // may have changed (e.g. a prior auto-entry drained bankroll).
          const gate = s.checkLiveEntry(opp.id);
          if (!gate.ok) {
            s.logAudit(`AUTO_SKIP · ${opp.token} · ${gate.error}`, "safety");
            continue;
          }

          // Phase 2: commit the request (writes ENTRY_REQUESTED log).
          const committed = s.requestLiveEntry(opp.id);
          if (!committed.ok) {
            s.logAudit(`AUTO_SKIP · ${opp.token} · ${committed.error}`, "safety");
            continue;
          }

          const outputMint = opp.mint ?? opp.tokenAddress ?? null;
          if (!outputMint) {
            s.logAudit(`AUTO_SKIP · ${opp.token} · no mint resolved`, "safety");
            continue;
          }

          s.logAudit(
            `AUTO_ENTRY · ${opp.token} · size ${committed.sizeSol.toFixed(5)} SOL · score ${opp.safetyScore ?? opp.score ?? opp.safety}`,
            "execution",
          );

          try {
            const amountLamports = Math.max(1, Math.floor(committed.sizeSol * LAMPORTS_PER_SOL));
            // Pump.fun bonding-curve tokens can't be routed through Jupiter
            // (they're on pump.fun's internal curve, not an AMM). Route them
            // to the pump.fun buy program instead. The venue field is set by
            // both the discovery feed and the DexScreener stream.
            const isPumpFunBondingCurve = opp.venue === "pumpfun";
            const result = await executeSwap({
              inputMint: SOL_MINT,
              outputMint,
              amountLamports,
              slippageBps: 300,
              maxPriceImpactPct: 15,
              isPumpFunBondingCurve,
            });
            s.confirmLiveEntry({
              opportunityId: opp.id,
              sizeSol: committed.sizeSol,
              signature: result.signature,
              tokensReceivedRaw: result.outAmount,
            });
            s.logAudit(
              `LIVE_SWAP_CONFIRMED · ${opp.token} · in ${amountLamports} lamports · out ${result.outAmount} · impact ${result.priceImpactPct}%`,
              "execution",
            );
            toast.success(`Auto-entry filled · ${opp.token}`, {
              description: `${committed.sizeSol.toFixed(4)} SOL · score ${opp.safetyScore ?? opp.score ?? opp.safety}`,
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const stage = (err as { stage?: string }).stage;
            s.logAudit(
              `LIVE_SWAP_FAILED${stage ? ` · stage=${stage}` : ""} · ${opp.token} · ${message}`,
              "error",
            );
            s.failLiveEntry({ opportunityId: opp.id, reason: message });
            toast.error(`Auto-entry failed · ${opp.token}`, {
              description: stage ? `${stage}: ${message}` : message,
            });
          }
        }
      });
    });
    return () => unsub();
  }, [connected, publicKey, signTransaction, sniper, canSign, useBatchEntry, executeSwap, executeBatchSwaps, walletReady]);
}
