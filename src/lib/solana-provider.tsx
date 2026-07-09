import { useEffect, useState, type ComponentType, type ReactNode } from "react";

// Client-only wrapper. @solana/* pulls rpc-websockets which has no
// workerd export condition, so it must never enter the SSR bundle.
// We dynamic-import the real providers on the client after mount.

export function SolanaProviders({ children }: { children: ReactNode }) {
  const [Providers, setProviders] = useState<ComponentType<{ children: ReactNode }> | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    import("./solana-provider-client").then((m) => {
      if (!cancelled) setProviders(() => m.SolanaProviders);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!Providers) return <>{children}</>;
  return <Providers>{children}</Providers>;
}
