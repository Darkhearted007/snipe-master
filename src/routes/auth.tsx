import { useEffect, useState } from "react";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { ShieldCheck, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useWalletReady } from "@/lib/solana-provider";
import { useAuthSession } from "@/hooks/use-auth-session";
import { LazySiwsPanel } from "@/components/wallet-lazy";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — SniperBot" },
      {
        name: "description",
        content: "Sign in with your Solana wallet to access the SniperBot operator dashboard.",
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
            Connect your Solana wallet and sign a one-time challenge. No transaction, no gas.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {walletReady ? (
            <LazySiwsPanel />
          ) : (
            <Button disabled className="w-full gap-1.5">
              <Wallet className="h-4 w-4" /> Loading wallet…
            </Button>
          )}
          <Alert>
            <AlertTitle className="text-xs">How access works</AlertTitle>
            <AlertDescription className="text-xs text-muted-foreground">
              New wallets start with <span className="font-mono">viewer</span> access. An admin can
              promote you to <span className="font-mono">trader</span> to control the bot. The
              bootstrap admin wallet is auto-promoted on first sign-in.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    </div>
  );
}
