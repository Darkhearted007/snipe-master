import {
  createContext,
  useContext,
  useEffect,
  useMemo,
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

function getEndpoint(): string {
  if (typeof window !== "undefined") return `${window.location.origin}/api/rpc`;
  return "https://api.mainnet-beta.solana.com";
}

async function loadSolanaProviders(): Promise<ComponentType<{ children: ReactNode }>> {
  // This must resolve before any @solana package is evaluated. Several wallet
  // packages read Buffer during module init, and a static import can race the shim
  // in production chunks.
  await import("./buffer-shim");
  await import("../vendor/wallet-adapter.css");

  const [walletReact, walletUi, phantom, solflare] = await Promise.all([
    import("@solana/wallet-adapter-react"),
    import("@solana/wallet-adapter-react-ui"),
    import("@solana/wallet-adapter-phantom"),
    import("@solana/wallet-adapter-solflare"),
  ]);

  const { ConnectionProvider, WalletProvider } = walletReact;
  const { WalletModalProvider } = walletUi;
  const { PhantomWalletAdapter } = phantom;
  const { SolflareWalletAdapter } = solflare;

  return function LoadedSolanaProviders({ children }: { children: ReactNode }) {
    const endpoint = useMemo(() => getEndpoint(), []);
    const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);

    return (
      <ConnectionProvider endpoint={endpoint}>
        <WalletProvider wallets={wallets} autoConnect>
          <WalletModalProvider>{children}</WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
    );
  };
}

const providersPromise: Promise<ComponentType<{ children: ReactNode }>> | null =
  typeof window !== "undefined" ? loadSolanaProviders() : null;

export function SolanaProviders({ children }: { children: ReactNode }) {
  const [Providers, setProviders] = useState<ComponentType<{ children: ReactNode }> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (providersPromise ?? loadSolanaProviders())
      .then((Provider) => {
        if (!cancelled) setProviders(() => Provider);
      })
      .catch((error) => {
        console.error("Solana wallet runtime failed to load", error);
        if (!cancelled) setProviders(null);
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
