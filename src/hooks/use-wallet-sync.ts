import { useEffect } from "react";
import { PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useBotStore } from "@/lib/bot-store";
import { useSniperSigner } from "@/components/sniper-signer-provider";

/** Only mount this inside SolanaProviders (when useWalletReady() is true).
 *  Pushes the ACTIVE signing wallet into the bot store: the Sniper Signer
 *  (burner key, no popups) when armed — even if the wallet extension is
 *  disconnected — otherwise the wallet adapter. */
export function useWalletSync() {
  const { connection } = useConnection();
  const { publicKey, connected, connecting, wallet } = useWallet();
  const { signer } = useSniperSigner();
  const setWalletFromAdapter = useBotStore((s) => s.setWalletFromAdapter);
  const setWalletBalance = useBotStore((s) => s.setWalletBalance);

  // When the Sniper Signer is armed it IS the trading wallet. The adapter's
  // connection state becomes irrelevant: the bot must see a connected
  // wallet with the burner address so live mode can start and auto-execute
  // can arm even while the extension sits disconnected.
  const activeAddress = signer ? signer.address : publicKey ? publicKey.toBase58() : null;
  const activeConnected = signer ? true : connected;
  const activeName = signer ? "Sniper Signer" : (wallet?.adapter.name ?? null);

  useEffect(() => {
    let cancelled = false;

    setWalletFromAdapter({
      connected: activeConnected,
      connecting: signer ? false : connecting,
      address: activeAddress,
      walletName: activeName,
    });

    const refreshBalance = async () => {
      if (!activeAddress) {
        setWalletBalance(null);
        return;
      }
      try {
        const lamports = await connection.getBalance(new PublicKey(activeAddress), "confirmed");
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
    activeAddress,
    activeConnected,
    activeName,
    connecting,
    signer,
    setWalletFromAdapter,
    setWalletBalance,
  ]);
}
