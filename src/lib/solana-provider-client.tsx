// Buffer polyfill MUST be first — @solana/web3.js and wallet adapters
// touch Buffer during module init, and this chunk is dynamic-imported so we
// can't rely on the shim loaded by __root.tsx being present yet.
import "./buffer-shim";
import "../vendor/wallet-adapter.css";
import { useMemo, type ReactNode } from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";

// Wallet Standard auto-discovers modern wallets (Phantom, Solflare,
// Backpack, Coinbase, Trust, Glow, OKX, …) from `window`. We ALSO register
// the legacy Phantom + Solflare adapters as an explicit fallback so the
// modal always shows entries even if Wallet Standard registration is late
// or the injected provider hasn't fired its ready event yet.

function getEndpoint(): string {
  // Browser calls our server-side Helius proxy so the API key never leaves the sandbox.
  if (typeof window !== "undefined") {
    return `${window.location.origin}/api/rpc`;
  }
  // SSR fallback — never actually used for RPC calls during SSR.
  return "https://api.mainnet-beta.solana.com";
}

export function SolanaProviders({ children }: { children: ReactNode }) {
  const endpoint = useMemo(() => getEndpoint(), []);
  const wallets = useMemo(() => NO_LEGACY_ADAPTERS, []);
  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
