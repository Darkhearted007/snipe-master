import { CheckCircle2, AlertCircle, WalletMinimal } from "lucide-react";
import { useBotStore } from "@/lib/bot-store";

/** Minimum SOL needed to open a position (matches bot minimum trade size). */
const MIN_TRADE_SOL = 0.1;
/** Buffer above min-trade for network fees + slippage. */
const FEE_BUFFER_SOL = 0.02;
const READY_THRESHOLD = MIN_TRADE_SOL + FEE_BUFFER_SOL;

/** Compact readiness pill showing whether the connected wallet has enough
 *  SOL to execute a live trade. Reads walletBalanceSol synced by WalletBar. */
export function WalletReadinessBadge() {
  const balance = useBotStore((s) => s.walletBalanceSol);
  const mode = useBotStore((s) => s.mode);

  if (mode !== "live") return null;
  if (balance === null) {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-border bg-muted/40 px-2 py-1 font-mono text-[10px] text-muted-foreground">
        <WalletMinimal className="h-3 w-3" /> wallet: not connected
      </span>
    );
  }

  const ready = balance >= READY_THRESHOLD;
  if (ready) {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-success/40 bg-success/10 px-2 py-1 font-mono text-[10px] text-success">
        <CheckCircle2 className="h-3 w-3" /> tradable · {balance.toFixed(3)} SOL
      </span>
    );
  }

  const deficit = (READY_THRESHOLD - balance).toFixed(3);
  return (
    <span
      className="inline-flex items-center gap-1 rounded border border-warning/40 bg-warning/10 px-2 py-1 font-mono text-[10px] text-warning"
      title={`Need at least ${READY_THRESHOLD} SOL (${MIN_TRADE_SOL} trade + ${FEE_BUFFER_SOL} fee buffer). Deposit ~${deficit} SOL more.`}
    >
      <AlertCircle className="h-3 w-3" /> low balance · {balance.toFixed(4)} SOL
    </span>
  );
}
