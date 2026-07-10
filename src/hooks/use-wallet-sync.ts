import { useContext, useEffect } from "react";
import { WalletContext } from "@solana/wallet-adapter-react";
import { useBotStore } from "@/lib/bot-store";

/** Safely read wallet-adapter state without throwing when the client-only
 *  SolanaProviders hasn't mounted yet (its default context getters throw). */
export function safeReadWallet() {
  const ctx = useContext(WalletContext);
  try {
    const publicKey = ctx?.publicKey ?? null;
    return {
      ready: true,
      publicKey,
      connected: ctx?.connected ?? false,
      connecting: ctx?.connecting ?? false,
      wallet: ctx?.wallet ?? null,
      disconnect: ctx?.disconnect ?? (async () => {}),
      address: publicKey ? publicKey.toBase58() : null,
      walletName: ctx?.wallet?.adapter.name ?? null,
    };
  } catch {
    return {
      ready: false,
      publicKey: null,
      connected: false,
      connecting: false,
      wallet: null,
      disconnect: async () => {},
      address: null as string | null,
      walletName: null as string | null,
    };
  }
}

export function useWalletSync() {
  const w = safeReadWallet();
  const setWalletFromAdapter = useBotStore((s) => s.setWalletFromAdapter);
  useEffect(() => {
    if (!w.ready) return;
    setWalletFromAdapter({
      connected: w.connected,
      connecting: w.connecting,
      address: w.address,
      walletName: w.walletName,
    });
  }, [w.ready, w.connected, w.connecting, w.address, w.walletName, setWalletFromAdapter]);
}
