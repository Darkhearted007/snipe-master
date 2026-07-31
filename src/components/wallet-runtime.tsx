import "@/lib/buffer-shim";

import { useState } from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useWallet } from "@solana/wallet-adapter-react";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { WalletBar as RuntimeWalletBar } from "@/components/wallet-bar";
import { useLiveExecutor } from "@/hooks/use-live-executor";
import { useLiveExecution } from "@/hooks/use-live-execution";
import { requestNonce, verifySiws } from "@/lib/auth.functions";
import { SOL_MINT } from "@/lib/jupiter";
import { useBotStore } from "@/lib/bot-store";
import type { Opportunity } from "@/lib/bot-types";
import { supabase } from "@/integrations/supabase/client";

const LAMPORTS_PER_SOL = 1_000_000_000;

export function WalletBar() {
  return <RuntimeWalletBar />;
}

export function LiveExecutorMount() {
  useLiveExecutor();
  return null;
}

export function SiwsPanel() {
  const [busy, setBusy] = useState(false);
  const reqNonce = useServerFn(requestNonce);
  const verify = useServerFn(verifySiws);
  const { publicKey, signMessage, connected } = useWallet();
  const navigate = useNavigate();
  const router = useRouter();

  const handleSignIn = async () => {
    if (!connected || !publicKey || !signMessage) {
      toast.error("Connect a wallet first");
      return;
    }
    setBusy(true);
    try {
      const address = publicKey.toBase58();
      const { nonce } = await reqNonce({ data: { walletAddress: address } });
      const msg = new TextEncoder().encode(
        ["Sign in to SniperBot Dashboard", "", `Wallet: ${address}`, `Nonce: ${nonce}`].join("\n"),
      );
      const sigBytes = await signMessage(msg);
      const bs58 = (await import("bs58")).default;
      const signature = bs58.encode(sigBytes);
      const { tokenHash } = await verify({ data: { walletAddress: address, signature, nonce } });
      const { error: otpErr } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: "magiclink",
      });
      if (otpErr) throw new Error(otpErr.message);
      toast.success("Signed in", { description: `${address.slice(0, 4)}…${address.slice(-4)}` });
      router.invalidate();
      navigate({ to: "/", replace: true });
    } catch (e) {
      toast.error("Sign-in failed", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-md border bg-muted/30 p-2">
        <RuntimeWalletBar />
      </div>
      <Button className="w-full gap-1.5" onClick={handleSignIn} disabled={busy || !connected}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
        {connected ? "Sign challenge & sign in" : "Connect a wallet first"}
      </Button>
    </div>
  );
}

export function LiveExecuteButton({ opp }: { opp: Opportunity }) {
  const mode = useBotStore((s) => s.mode);
  const checkLiveEntry = useBotStore((s) => s.checkLiveEntry);
  const requestLiveEntry = useBotStore((s) => s.requestLiveEntry);
  const confirmLiveEntry = useBotStore((s) => s.confirmLiveEntry);
  const failLiveEntry = useBotStore((s) => s.failLiveEntry);
  const logAudit = useBotStore((s) => s.logAudit);
  const { executeSwap, walletReady } = useLiveExecution();
  const [busy, setBusy] = useState(false);

  if (mode !== "live" || (!opp.mint && !opp.tokenAddress)) return null;

  // Pure — safe to call during render, does not touch the store.
  const gate = checkLiveEntry(opp.id);

  // Resolve the SPL mint the same way checkLiveEntry does: canonical `mint`
  // first, then `tokenAddress`. Both are set by the discovery/DexScreener
  // pipelines now, but fall back so a legacy opportunity with only one field
  // is still tradeable.
  const outputMint = opp.mint ?? opp.tokenAddress ?? null;

  return (
    <Button
      size="sm"
      variant={gate.ok ? "default" : "secondary"}
      disabled={!gate.ok || !walletReady || busy}
      title={gate.ok ? undefined : gate.error}
      onClick={async (e) => {
        e.stopPropagation();
        // Re-check + log the request at click time (opportunity/bankroll/
        // guardrail state may have moved since the last render).
        const committed = requestLiveEntry(opp.id);
        if (!committed.ok) {
          toast.error("Live entry rejected", { description: committed.error });
          return;
        }
        setBusy(true);
        try {
          const amountLamports = Math.max(1, Math.floor(committed.sizeSol * LAMPORTS_PER_SOL));
          const result = await executeSwap({
            inputMint: SOL_MINT,
            outputMint: outputMint!,
            amountLamports,
            slippageBps: 300,
            maxPriceImpactPct: 15,
          });
          confirmLiveEntry({
            opportunityId: opp.id,
            sizeSol: committed.sizeSol,
            signature: result.signature,
          });
          logAudit(
            `LIVE_SWAP_CONFIRMED · ${opp.token} · in ${amountLamports} lamports · out ${result.outAmount} · impact ${result.priceImpactPct}%`,
            "execution",
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const stage = (err as { stage?: string }).stage;
          logAudit(
            `LIVE_SWAP_FAILED${stage ? ` · stage=${stage}` : ""} · ${opp.token} · ${message}`,
            "error",
          );
          failLiveEntry({
            opportunityId: opp.id,
            reason: message,
          });
          toast.error("Live swap failed", {
            description: stage ? `${stage}: ${message}` : message,
          });
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "Executing…" : "Execute"}
    </Button>
  );
}
