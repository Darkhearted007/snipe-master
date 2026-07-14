import { Wallet } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
import { computeBackoff } from "@/lib/retry-backoff";

function shortAddr(a: string) {
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}

const HEALTHY_POLL_MS = 20_000;

function useSolBalance(address: string | null) {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [balance, setBalance] = useState<number | null>(null);
  const [degraded, setDegraded] = useState(false);
  const setWalletBalance = useBotStore((s) => s.setWalletBalance);
  const failuresRef = useRef(0);

  useEffect(() => {
    if (!publicKey || !address) {
      setBalance(null);
      setDegraded(false);
      setWalletBalance?.(null);
      return;
    }
    let cancelled = false;
    let timer: number | null = null;
    let subId: number | null = null;

    const apply = (sol: number | null) => {
      if (cancelled) return;
      setBalance(sol);
      setWalletBalance?.(sol);
    };

    const scheduleNext = (delay: number) => {
      if (cancelled) return;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => void tick(), delay);
    };

    const resubscribe = () => {
      if (subId !== null) {
        void connection.removeAccountChangeListener(subId).catch(() => {});
        subId = null;
      }
      try {
        subId = connection.onAccountChange(
          publicKey,
          (acc) => apply(acc.lamports / LAMPORTS_PER_SOL),
          "confirmed",
        );
      } catch {
        // ignored — poller will keep balance fresh
      }
    };

    const tick = async () => {
      if (cancelled) return;
      try {
        const lamports = await connection.getBalance(publicKey, "confirmed");
        apply(lamports / LAMPORTS_PER_SOL);
        if (failuresRef.current > 0) {
          // Recovered: reset counter, refresh subscription, resume normal cadence.
          failuresRef.current = 0;
          setDegraded(false);
          resubscribe();
        }
        scheduleNext(HEALTHY_POLL_MS);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const transient = /Failed to fetch|NetworkError|fetch failed|timeout/i.test(msg);
        failuresRef.current += 1;
        if (failuresRef.current >= 2) setDegraded(true);
        if (!transient) console.warn("balance fetch failed", err);
        // Full-jitter exponential backoff, capped at 30s.
        const delay = Math.max(500, computeBackoff(failuresRef.current - 1, { baseMs: 1000, maxMs: 30_000 }));
        scheduleNext(delay);
      }
    };

    resubscribe();
    void tick();

    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
      if (subId !== null) {
        void connection.removeAccountChangeListener(subId).catch(() => {});
      }
    };
  }, [connection, publicKey, address, setWalletBalance]);

  return { balance, degraded };
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
  const { balance, degraded } = useSolBalance(address);

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
              {degraded && <span className="ml-1 text-warning">⟳</span>}
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
