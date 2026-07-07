import { useState } from "react";
import { AlertTriangle, Loader2, Play, Power, Square, Wallet } from "lucide-react";
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

function shortAddr(a: string | null) {
  if (!a) return "";
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}

export function ControlHeader() {
  const mode = useBotStore((s) => s.mode);
  const status = useBotStore((s) => s.status);
  const setMode = useBotStore((s) => s.setMode);
  const start = useBotStore((s) => s.start);
  const stop = useBotStore((s) => s.stop);
  const kill = useBotStore((s) => s.killSwitch);
  const liveConfirmed = useBotStore((s) => s.liveConfirmed);
  const confirmLive = useBotStore((s) => s.confirmLive);
  const walletConnected = useBotStore((s) => s.walletConnected);
  const walletAddress = useBotStore((s) => s.walletAddress);
  const walletConnecting = useBotStore((s) => s.walletConnecting);
  const walletError = useBotStore((s) => s.walletError);
  const connectWallet = useBotStore((s) => s.connectWallet);
  const disconnectWallet = useBotStore((s) => s.disconnectWallet);
  const breached = useBotStore((s) => s.guardrailBreached);

  const [liveDialog, setLiveDialog] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [killDialog, setKillDialog] = useState(false);

  const handleMode = (m: BotMode) => {
    if (m === "live" && !liveConfirmed) {
      setLiveDialog(true);
      return;
    }
    setMode(m);
  };

  const isRunning = status === "running";
  const canStart =
    !breached && (mode === "paper" || (liveConfirmed && walletConnected));

  const handleStart = () => {
    if (!canStart) {
      toast.error("Cannot start", {
        description: breached
          ? "Guardrail breached — acknowledge in Settings."
          : "Live mode requires wallet connection.",
      });
      return;
    }
    start();
    toast.success(`Bot running · ${mode.toUpperCase()}`);
  };

  const handleConnect = async () => {
    await connectWallet();
    const err = useBotStore.getState().walletError;
    if (err) {
      toast.error("Wallet connect failed", { description: err });
    } else {
      const addr = useBotStore.getState().walletAddress;
      toast.success("Wallet connected", { description: shortAddr(addr) });
    }
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
        (walletConnected && walletAddress ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="sm" className="gap-1.5">
                <Wallet className="h-3.5 w-3.5" />
                <span className="font-mono text-xs">{shortAddr(walletAddress)}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuLabel className="text-xs">Connected wallet</DropdownMenuLabel>
              <div className="px-2 pb-2 font-mono text-[10px] break-all text-muted-foreground">
                {walletAddress}
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={copyAddress}>Copy address</DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  disconnectWallet();
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
            onClick={handleConnect}
            className="gap-1.5"
            disabled={walletConnecting}
          >
            {walletConnecting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Wallet className="h-3.5 w-3.5" />
            )}
            <span className="font-mono text-xs">
              {walletConnecting ? "Connecting…" : "Connect wallet"}
            </span>
          </Button>
        ))}

      {mode === "live" && walletError && !walletConnected && (
        <Badge variant="destructive" className="gap-1 text-[10px]">
          <AlertTriangle className="h-3 w-3" /> {walletError}
        </Badge>
      )}

      <div className="ml-auto flex items-center gap-2">
        {breached && (
          <Badge variant="destructive" className="gap-1">
            <AlertTriangle className="h-3 w-3" /> Guardrail breach
          </Badge>
        )}
        {status === "error" && (
          <Badge variant="destructive" className="gap-1">
            <AlertTriangle className="h-3 w-3" /> Recovering
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
            disabled={!canStart}
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
                  description: "Connect wallet to start.",
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
