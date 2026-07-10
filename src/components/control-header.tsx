import { useContext, useState } from "react";
import { AlertTriangle, Play, Power, Square, Wallet } from "lucide-react";
import { WalletContext } from "@solana/wallet-adapter-react";
import { WalletModalContext } from "@solana/wallet-adapter-react-ui";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useBotStore } from "@/lib/bot-store";
import type { BotMode } from "@/lib/bot-types";
import { useWalletSync } from "@/hooks/use-wallet-sync";

function shortAddr(a: string | null) {
  if (!a) return "";
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}

export function ControlHeader() {
  useWalletSync();

  const walletCtx = useContext(WalletContext);
  const modalCtx = useContext(WalletModalContext);
  const publicKey = walletCtx?.publicKey ?? null;
  const connected = walletCtx?.connected ?? false;
  const disconnect = walletCtx?.disconnect ?? (async () => {});
  const wallet = walletCtx?.wallet ?? null;
  const openWalletModal = (v: boolean) => modalCtx?.setVisible(v);

  const mode = useBotStore((s) => s.mode);
  const status = useBotStore((s) => s.status);
  const setMode = useBotStore((s) => s.setMode);
  const start = useBotStore((s) => s.start);
  const stop = useBotStore((s) => s.stop);
  const kill = useBotStore((s) => s.killSwitch);
  const liveConfirmed = useBotStore((s) => s.liveConfirmed);
  const confirmLive = useBotStore((s) => s.confirmLive);
  const breached = useBotStore((s) => s.guardrailBreached);

  const [liveDialog, setLiveDialog] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [killDialog, setKillDialog] = useState(false);

  const walletAddress = publicKey?.toBase58() ?? null;
  const walletName = wallet?.adapter.name ?? null;

  const handleMode = (m: BotMode) => {
    if (m === mode) return;
    if (m === "live" && !liveConfirmed) {
      setLiveDialog(true);
      return;
    }
    setMode(m);
    toast.success(`Switched to ${m.toUpperCase()} mode`, {
      description:
        m === "live" && !connected
          ? "Connect a wallet before pressing Start."
          : m === "live"
            ? "Wallet ready — press Start when you want to trade."
            : "Simulation only — safe to experiment.",
    });
  };

  const isRunning = status === "running" || status === "paused";
  const startBlockedReason = breached
    ? "Guardrail breached — acknowledge in Settings."
    : mode === "live" && !liveConfirmed
      ? "Enable Live mode acknowledgement first."
      : mode === "live" && !connected
        ? "Connect a wallet to start Live mode."
        : null;

  const handleStart = () => {
    if (startBlockedReason) {
      toast.error("Cannot start", { description: startBlockedReason });
      return;
    }
    start();
    toast.success(`Bot running · ${mode.toUpperCase()}`);
  };

  const copyAddress = async () => {
    if (!walletAddress) return;
    try {
      await navigator.clipboard.writeText(walletAddress);
      toast("Address copied");
    } catch {
      toast.error("Copy failed");
    }
  };

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/95 px-3 backdrop-blur">
      <SidebarTrigger />
      <div className="flex items-center rounded-md border bg-muted p-0.5">
        <ModeButton active={mode === "paper"} onClick={() => handleMode("paper")}>
          Paper
        </ModeButton>
        <ModeButton
          active={mode === "live"}
          live
          onClick={() => handleMode("live")}
        >
          Solana Live
        </ModeButton>
      </div>

      {mode === "live" &&
        (connected && walletAddress ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="sm" className="gap-1.5">
                <Wallet className="h-3.5 w-3.5" />
                <span className="font-mono text-xs">{shortAddr(walletAddress)}</span>
                {walletName && (
                  <span className="text-[10px] text-muted-foreground">
                    {walletName}
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuLabel className="text-xs">
                {walletName ? `${walletName} · connected` : "Connected wallet"}
              </DropdownMenuLabel>
              <div className="px-2 pb-2 font-mono text-[10px] break-all text-muted-foreground">
                {walletAddress}
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={copyAddress}>Copy address</DropdownMenuItem>
              <DropdownMenuItem onClick={() => openWalletModal(true)}>
                Change wallet
              </DropdownMenuItem>
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
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => openWalletModal(true)}
            className="gap-1.5"
          >
            <Wallet className="h-3.5 w-3.5" />
            <span className="font-mono text-xs">Connect wallet</span>
          </Button>
        ))}

      <div className="ml-auto flex items-center gap-2">
        {startBlockedReason && !isRunning && (
          <Badge variant="secondary" className="hidden gap-1 md:inline-flex">
            <AlertTriangle className="h-3 w-3 text-warning" />
            <span className="text-[10px]">{startBlockedReason}</span>
          </Badge>
        )}
        {breached && (
          <Badge variant="destructive" className="gap-1">
            <AlertTriangle className="h-3 w-3" /> Guardrail breach
          </Badge>
        )}
        {isRunning ? (
          <Button onClick={stop} variant="destructive" size="sm" className="gap-1.5">
            <Square className="h-3.5 w-3.5 fill-current" /> Stop
          </Button>
        ) : (
          <Button
            onClick={handleStart}
            size="sm"
            className="gap-1.5 bg-success text-success-foreground hover:bg-success/90"
          >
            <Play className="h-3.5 w-3.5 fill-current" /> Start
          </Button>
        )}
        <Button
          variant="outline"
          size="icon"
          onClick={() => setKillDialog(true)}
          title="Kill switch"
          className="border-danger/50 text-danger hover:bg-danger hover:text-danger-foreground"
        >
          <Power className="h-4 w-4" />
        </Button>
      </div>

      <AlertDialog open={liveDialog} onOpenChange={setLiveDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-warning" />
              Enable Solana Live Mode
            </AlertDialogTitle>
            <AlertDialogDescription>
              Live mode executes real Solana transactions against your curated
              token universe. Profits are returned to your connected wallet.
              A configurable platform fee (default 10%) is taken from profits
              only and routed to the platform treasury. Losses are irreversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 p-3">
            <Switch
              id="ack"
              checked={acknowledged}
              onCheckedChange={setAcknowledged}
            />
            <Label htmlFor="ack" className="text-sm">
              I understand real funds are at risk.
            </Label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setAcknowledged(false)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={!acknowledged}
              onClick={() => {
                confirmLive();
                setMode("live");
                setLiveDialog(false);
                toast("Live mode enabled", {
                  description: connected
                    ? "Wallet ready — press Start when ready."
                    : "Connect a wallet to start.",
                });
              }}
            >
              Enable Live
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={killDialog} onOpenChange={setKillDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Trigger kill switch?</AlertDialogTitle>
            <AlertDialogDescription>
              Immediately stops the bot and flattens every open position.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-danger text-danger-foreground hover:bg-danger/90"
              onClick={() => {
                kill();
                toast.error("Positions flattened", { description: "Bot halted." });
              }}
            >
              Kill now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </header>
  );
}

function ModeButton({
  active,
  live,
  onClick,
  children,
}: {
  active: boolean;
  live?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded px-3 py-1 text-xs font-medium transition-colors",
        active
          ? live
            ? "bg-live text-live-foreground"
            : "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
