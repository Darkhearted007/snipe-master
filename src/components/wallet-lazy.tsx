import { lazy, Suspense, type ReactNode } from "react";
import { Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Opportunity } from "@/lib/bot-types";

const WalletBarImpl = lazy(() =>
  import("@/components/wallet-runtime").then((m) => ({ default: m.WalletBar })),
);

const SiwsPanelImpl = lazy(() =>
  import("@/components/wallet-runtime").then((m) => ({ default: m.SiwsPanel })),
);

const LiveExecutorMountImpl = lazy(() =>
  import("@/components/wallet-runtime").then((m) => ({ default: m.LiveExecutorMount })),
);

const LiveExecuteButtonImpl = lazy(() =>
  import("@/components/wallet-runtime").then((m) => ({ default: m.LiveExecuteButton })),
);

const AutoExecutorMountImpl = lazy(() =>
  import("@/components/wallet-runtime").then((m) => ({ default: m.AutoExecutorMount })),
);

function WalletLoadingButton({ children = "Loading wallet…" }: { children?: ReactNode }) {
  return (
    <Button disabled variant="outline" size="sm" className="gap-1.5">
      <Wallet className="h-3.5 w-3.5" />
      <span className="font-mono text-xs">{children}</span>
    </Button>
  );
}

export function LazyWalletBar() {
  return (
    <Suspense fallback={<WalletLoadingButton />}>
      <WalletBarImpl />
    </Suspense>
  );
}

export function LazySiwsPanel() {
  return (
    <Suspense fallback={<WalletLoadingButton>Loading wallet…</WalletLoadingButton>}>
      <SiwsPanelImpl />
    </Suspense>
  );
}

export function LazyLiveExecutorMount() {
  return (
    <Suspense fallback={null}>
      <LiveExecutorMountImpl />
    </Suspense>
  );
}

export function LazyLiveExecuteButton({ opp }: { opp: Opportunity }) {
  return (
    <Suspense fallback={null}>
      <LiveExecuteButtonImpl opp={opp} />
    </Suspense>
  );
}

export function LazyAutoExecutorMount() {
  return (
    <Suspense fallback={null}>
      <AutoExecutorMountImpl />
    </Suspense>
  );
}
