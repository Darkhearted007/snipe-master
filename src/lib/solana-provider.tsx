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

export function SolanaProviders({ children }: { children: ReactNode }) {
  const [Providers, setProviders] = useState<ComponentType<{ children: ReactNode }> | null>(null);

  useEffect(() => {
    let cancelled = false;
    import("./solana-provider-client").then((m) => {
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
