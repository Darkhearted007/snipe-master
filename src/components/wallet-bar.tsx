import { Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { useWalletSync } from "@/hooks/use-wallet-sync";
import { useBotStore } from "@/lib/bot-store";

function shortAddr(a: string) {
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}

function useSolBalance(address: string | null) {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [balance, setBalance] = useState<number | null>(null);
  const setWalletBalance = useBotStore((s) => s.setWalletBalance);

  useEffect(() => {
    if (!publicKey || !address) {
      setBalance(null);
      setWalletBalance?.(null);
      return;
    }
    let cancelled = false;
    const apply = (sol: number | null) => {
      if (cancelled) return;
      setBalance(sol);
      setWalletBalance?.(sol);
    };
    const fetchBalance = async () => {
      try {
        const lamports = await connection.getBalance(publicKey, "confirmed");
        apply(lamports / LAMPORTS_PER_SOL);
      } catch (err) {
        console.warn("balance fetch failed", err);
      }
    };
    void fetchBalance();
    const id = window.setInterval(fetchBalance, 20_000);
    let subId: number | null = null;
    try {
      subId = connection.onAccountChange(
        publicKey,
        (acc) => apply(acc.lamports / LAMPORTS_PER_SOL),
        "confirmed",
      );
    } catch (err) {
      console.warn("balance subscribe failed", err);
    }
    return () => {
      cancelled = true;
      window.clearInterval(id);
      if (subId !== null) {
        void connection.removeAccountChangeListener(subId).catch(() => {});
      }
    };
  }, [connection, publicKey, address, setWalletBalance]);

  return balance;
}

function formatSol(sol: number | null): string {
  if (sol === null) return "—";
  if (sol >= 1) return `${sol.toFixed(3)} SOL`;
  return `${sol.toFixed(4)} SOL`;
}

/** Renders the wallet connect/dropdown button.
 *  MUST only be mounted inside SolanaProviders (guard with useWalletReady). */
export function WalletBar() {
  useWalletSync();
  const { publicKey, connected, disconnect, wallet } = useWallet();
  const { setVisible } = useWalletModal();
  const address = publicKey?.toBase58() ?? null;
  const name = wallet?.adapter.name ?? null;
  const balance = useSolBalance(address);

  const copy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      toast("Address copied");
    } catch {
      toast.error("Copy failed");
    }
  };

  if (connected && address) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="sm" className="gap-1.5">
            <Wallet className="h-3.5 w-3.5" />
            <span className="font-mono text-xs">{shortAddr(address)}</span>
            <span className="font-mono text-[10px] text-muted-foreground">
              · {formatSol(balance)}
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel className="text-xs">
            {name ? `${name} · connected` : "Connected wallet"}
          </DropdownMenuLabel>
          <div className="px-2 pb-1 font-mono text-[10px] break-all text-muted-foreground">
            {address}
          </div>
          <div className="px-2 pb-2 font-mono text-xs text-foreground">
            Balance: {formatSol(balance)}
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={copy}>Copy address</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setVisible(true)}>Change wallet</DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              void disconnect();
              toast("Wallet disconnected");
            }}
            className="text-danger"
          >
            Disconnect
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <Button variant="outline" size="sm" onClick={() => setVisible(true)} className="gap-1.5">
      <Wallet className="h-3.5 w-3.5" />
      <span className="font-mono text-xs">Connect wallet</span>
    </Button>
  );
}
