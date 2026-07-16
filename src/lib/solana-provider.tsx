import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";

// Client-only wrapper. @solana/* pulls rpc-websockets which has no
// workerd export condition, so it must never enter the SSR bundle.
// We dynamic-import the real providers on the client after mount.

const WalletReadyContext = createContext(false);
export function useWalletReady() {
  return useContext(WalletReadyContext);
}

// Kick off the dynamic import at module-evaluation time (client only) so the
// wallet-adapter chunk is already downloading/parsing by the time <SolanaProviders>
// mounts. Falls back gracefully during SSR where `window` is undefined.
const providersPromise: Promise<typeof import("./solana-provider-client")> | null =
  typeof window !== "undefined" ? import("./solana-provider-client") : null;

export function SolanaProviders({ children }: { children: ReactNode }) {
  const [Providers, setProviders] = useState<ComponentType<{ children: ReactNode }> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (providersPromise ?? import("./solana-provider-client")).then((m) => {
      if (!cancelled) setProviders(() => m.SolanaProviders);
    });
    return () => {
      cancelled = true;
    };
  }, []);


  if (!Providers) {
    return <WalletReadyContext.Provider value={false}>{children}</WalletReadyContext.Provider>;
  }
  return (
    <WalletReadyContext.Provider value={true}>
      <Providers>{children}</Providers>
    </WalletReadyContext.Provider>
  );
}
