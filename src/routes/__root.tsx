import "../lib/buffer-shim";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/600.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
import { useEffect, useState, type ReactNode } from "react";

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
import { useDexScreenerStream } from "@/hooks/use-dexscreener-stream";
import { useLiveExecutor } from "@/hooks/use-live-executor";
import { useBotStore } from "@/lib/bot-store";
import { useWalletReady } from "@/lib/solana-provider";
import { GlobalErrorBoundary } from "@/components/global-error-boundary";
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
  if (path === "/auth") return <Outlet />;
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
  const mode = useBotStore((s) => s.mode);
  useDexScreenerStream(mode === "live");
  const walletReady = useWalletReady();
  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar />
        <div className="flex min-h-screen flex-1 flex-col">
          <ControlHeader />
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
  const navigate = useNavigate();

  useEffect(() => {
    if (session === null) {
      logStructured(new Error("no active session — redirecting to sign-in"), {
        category: "wallet",
        severity: "info",
        silent: true,
        context: { op: "auth-gate-redirect" },
      });
      navigate({ to: "/auth" });
    }
  }, [session, navigate]);

  if (session === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-xs text-muted-foreground">Loading session…</div>
      </div>
    );
  }
  if (session === null) return null;
  return <>{children}</>;
}

