import { useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useBotStore } from "@/lib/bot-store";

/** Mirror the real wallet-adapter state into the Zustand store. */
export function useWalletSync() {
  const { publicKey, connected, connecting, wallet } = useWallet();
  const setWalletFromAdapter = useBotStore((s) => s.setWalletFromAdapter);

  useEffect(() => {
    setWalletFromAdapter({
      connected,
      connecting,
      address: publicKey ? publicKey.toBase58() : null,
      walletName: wallet?.adapter.name ?? null,
    });
  }, [publicKey, connected, connecting, wallet, setWalletFromAdapter]);
}
