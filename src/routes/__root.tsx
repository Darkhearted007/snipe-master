import "../lib/buffer-shim";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/600.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  useNavigate,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useWallet } from "@solana/wallet-adapter-react";
import { Loader2, ShieldCheck, Wallet } from "lucide-react";
import { toast } from "sonner";
import { useEffect, useRef, useState, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ControlHeader } from "@/components/control-header";
import { StatusStrip } from "@/components/status-strip";
import { Toaster } from "@/components/ui/sonner";
import { useBotSimulator } from "@/hooks/use-bot-simulator";
import { SolanaProviders } from "@/lib/solana-provider";
import { useAuthSession } from "@/hooks/use-auth-session";
import { useServerPersistence } from "@/hooks/use-server-persistence";
import { useCouncilMemory } from "@/hooks/use-council-memory";
import { useDexScreenerStream } from "@/hooks/use-dexscreener-stream";
import { useLiveExecutor } from "@/hooks/use-live-executor";
import { useBotStore } from "@/lib/bot-store";
import { useWalletReady } from "@/lib/solana-provider";
import { GlobalErrorBoundary } from "@/components/global-error-boundary";
import { SchemaCheckBanner } from "@/components/schema-check-banner";
import { AppShellSkeleton } from "@/components/app-shell-skeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { WalletBar } from "@/components/wallet-bar";
import { requestNonce, verifySiws } from "@/lib/auth.functions";
import { supabase } from "@/integrations/supabase/client";


import { logStructured } from "@/lib/structured-logger";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "SniperBot — Control Dashboard" },
      {
        name: "description",
        content:
          "Operator dashboard for the SniperBot: paper-trading and opt-in Solana live mode with real-time status, guardrails, and decision logs.",
      },
      { property: "og:title", content: "SniperBot — Control Dashboard" },
      {
        property: "og:description",
        content:
          "Paper-trading and Solana live mode for newly created pairs — with start/stop, guardrails, and live opportunity feed.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  useEffect(() => {
    // Rehydrate persisted bot state after mount (persist has skipHydration).
    void useBotStore.persist.rehydrate();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <GlobalErrorBoundary>
        <SolanaProviders>
          <AppShell />
        </SolanaProviders>
      </GlobalErrorBoundary>
      <Toaster theme="dark" />
    </QueryClientProvider>
  );
}

function AppShell() {
  const path = useRouterState({ select: (r) => r.location.pathname });
  if (path === "/auth" || path.startsWith("/auth/")) return <Outlet />;
  return (
    <AuthGate>
      <AppLayout>
        <Outlet />
      </AppLayout>
    </AuthGate>
  );
}

function AppLayout({ children }: { children: ReactNode }) {
  useBotSimulator();
  useServerPersistence(true);
  useCouncilMemory();
  const mode = useBotStore((s) => s.mode);
  useDexScreenerStream(mode === "live");
  const walletReady = useWalletReady();
  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar />
        <div className="flex min-h-screen flex-1 flex-col">
          <ControlHeader />
          <SchemaCheckBanner />
          <StatusStrip />
          <main className="flex-1 p-4">{children}</main>
          {walletReady && <LiveExecutorMount />}
        </div>
      </div>
    </SidebarProvider>
  );
}

function LiveExecutorMount() {
  useLiveExecutor();
  return null;
}

function AuthGate({ children }: { children: ReactNode }) {
  const session = useAuthSession();
  const loggedRedirectRef = useRef(false);

  if (session === undefined) {
    return <AppShellSkeleton />;
  }

  if (session === null) {
    if (!loggedRedirectRef.current) {
      loggedRedirectRef.current = true;
      logStructured(new Error("no active session — redirecting to sign-in"), {
        category: "wallet",
        severity: "info",
        silent: true,
        context: { op: "auth-gate-redirect" },
      });
    }
    return <AuthScreen />;
  }
  return <>{children}</>;
}

function AuthScreen() {
  const walletReady = useWalletReady();

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
            <SiwsPanel />
          ) : (
            <Button disabled className="w-full gap-1.5">
              <Wallet className="h-4 w-4" /> Loading wallet…
            </Button>
          )}
          <Alert>
            <AlertTitle className="text-xs">How access works</AlertTitle>
            <AlertDescription className="text-xs text-muted-foreground">
              New wallets start with <span className="font-mono">viewer</span> access. An admin can
              promote you to <span className="font-mono">trader</span> to control the bot.
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
        <WalletBar />
      </div>
      <Button className="w-full gap-1.5" onClick={handleSignIn} disabled={busy || !connected}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
        {connected ? "Sign challenge & sign in" : "Connect a wallet first"}
      </Button>
    </div>
  );
}

