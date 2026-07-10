import { useContext, useEffect } from "react";
import { WalletContext } from "@solana/wallet-adapter-react";
import { useBotStore } from "@/lib/bot-store";

/** Mirror the real wallet-adapter state into the Zustand store.
 *  Uses useContext directly so it no-ops (instead of throwing) when
 *  the client-only SolanaProviders hasn't mounted yet. */
export function useWalletSync() {
  const ctx = useContext(WalletContext);
  const setWalletFromAdapter = useBotStore((s) => s.setWalletFromAdapter);

  const publicKey = ctx?.publicKey ?? null;
  const connected = ctx?.connected ?? false;
  const connecting = ctx?.connecting ?? false;
  const walletName = ctx?.wallet?.adapter.name ?? null;
  const address = publicKey ? publicKey.toBase58() : null;

  useEffect(() => {
    if (!ctx) return;
    setWalletFromAdapter({ connected, connecting, address, walletName });
  }, [ctx, connected, connecting, address, walletName, setWalletFromAdapter]);
}
