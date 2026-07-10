import { Wallet } from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
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

function shortAddr(a: string) {
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}

/** Renders the wallet connect/dropdown button.
 *  MUST only be mounted inside SolanaProviders (guard with useWalletReady). */
export function WalletBar() {
  useWalletSync();
  const { publicKey, connected, disconnect, wallet } = useWallet();
  const { setVisible } = useWalletModal();
  const address = publicKey?.toBase58() ?? null;
  const name = wallet?.adapter.name ?? null;

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
            {name && <span className="text-[10px] text-muted-foreground">{name}</span>}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel className="text-xs">
            {name ? `${name} · connected` : "Connected wallet"}
          </DropdownMenuLabel>
          <div className="px-2 pb-2 font-mono text-[10px] break-all text-muted-foreground">
            {address}
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
    <Button
      variant="outline"
      size="sm"
      onClick={() => setVisible(true)}
      className="gap-1.5"
    >
      <Wallet className="h-3.5 w-3.5" />
      <span className="font-mono text-xs">Connect wallet</span>
    </Button>
  );
}
