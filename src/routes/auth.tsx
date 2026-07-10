import { useEffect, useState } from "react";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useWallet } from "@solana/wallet-adapter-react";
import { Loader2, ShieldCheck, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { WalletBar } from "@/components/wallet-bar";
import { useWalletReady } from "@/lib/solana-provider";
import { requestNonce, verifySiws } from "@/lib/auth.functions";
import { supabase } from "@/integrations/supabase/client";
import { useAuthSession } from "@/hooks/use-auth-session";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — SniperBot" },
      {
        name: "description",
        content:
          "Sign in with your Solana wallet to access the SniperBot operator dashboard.",
      },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const walletReady = useWalletReady();
  const session = useAuthSession();
  const navigate = useNavigate();

  useEffect(() => {
    if (session) navigate({ to: "/" });
  }, [session, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <CardTitle>Sign in to SniperBot</CardTitle>
          </div>
          <CardDescription>
            Connect your Solana wallet and sign a one-time challenge. No transaction,
            no gas.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {walletReady ? (
            <SiwsPanel />
          ) : (
            <Button disabled className="w-full gap-1.5">
              <Wallet className="h-4 w-4" /> Loading wallet…
            </Button>
          )}
          <Alert>
            <AlertTitle className="text-xs">How access works</AlertTitle>
            <AlertDescription className="text-xs text-muted-foreground">
              New wallets start with <span className="font-mono">viewer</span>{" "}
              access. An admin can promote you to{" "}
              <span className="font-mono">trader</span> to control the bot. The
              bootstrap admin wallet is auto-promoted on first sign-in.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    </div>
  );
}

function SiwsPanel() {
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
        [
          "Sign in to SniperBot Dashboard",
          "",
          `Wallet: ${address}`,
          `Nonce: ${nonce}`,
        ].join("\n"),
      );
      const sigBytes = await signMessage(msg);
      const bs58 = (await import("bs58")).default;
      const signature = bs58.encode(sigBytes);
      const { email, tokenHash } = await verify({
        data: { walletAddress: address, signature, nonce },
      });
      const { error: otpErr } = await supabase.auth.verifyOtp({
        email,
        token_hash: tokenHash,
        type: "magiclink",
      });
      if (otpErr) throw new Error(otpErr.message);
      toast.success("Signed in", {
        description: `${address.slice(0, 4)}…${address.slice(-4)}`,
      });
      router.invalidate();
      navigate({ to: "/" });
    } catch (e) {
      toast.error("Sign-in failed", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-md border bg-muted/30 p-2">
        <WalletBar />
      </div>
      <Button
        className="w-full gap-1.5"
        onClick={handleSignIn}
        disabled={busy || !connected}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <ShieldCheck className="h-4 w-4" />
        )}
        {connected ? "Sign challenge & sign in" : "Connect a wallet first"}
      </Button>
    </div>
  );
}
