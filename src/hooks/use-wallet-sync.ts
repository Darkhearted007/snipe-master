import { useEffect } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useBotStore } from "@/lib/bot-store";

/** Only mount this inside SolanaProviders (when useWalletReady() is true). */
export function useWalletSync() {
  const { connection } = useConnection();
  const { publicKey, connected, connecting, wallet } = useWallet();
  const setWalletFromAdapter = useBotStore((s) => s.setWalletFromAdapter);
  const setWalletBalance = useBotStore((s) => s.setWalletBalance);

  useEffect(() => {
    let cancelled = false;

    setWalletFromAdapter({
      connected,
      connecting,
      address: publicKey ? publicKey.toBase58() : null,
      walletName: wallet?.adapter.name ?? null,
    });

    const refreshBalance = async () => {
      if (!connected || !publicKey) {
        setWalletBalance(null);
        return;
      }
      try {
        const lamports = await connection.getBalance(publicKey, "confirmed");
        if (!cancelled) {
          setWalletBalance(lamports / 1_000_000_000);
        }
      } catch {
        // Keep the last known balance if RPC is temporarily unavailable.
        // The store will continue using the current bankroll until the next successful refresh.
      }
    };

    void refreshBalance();

    const interval = window.setInterval(() => {
      void refreshBalance();
    }, 30_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [
    connection,
    publicKey,
    connected,
    connecting,
    wallet,
    setWalletFromAdapter,
    setWalletBalance,
  ]);
}
