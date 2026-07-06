import { cn } from "@/lib/utils";
import type { BotStatus } from "@/lib/bot-types";

const colorFor: Record<BotStatus, string> = {
  idle: "text-muted-foreground",
  running: "text-success",
  paused: "text-warning",
  error: "text-danger",
};

export function StatusDot({
  status,
  size = "sm",
}: {
  status: BotStatus;
  size?: "xs" | "sm" | "md";
}) {
  const dim = size === "xs" ? "h-1.5 w-1.5" : size === "md" ? "h-3 w-3" : "h-2 w-2";
  return (
    <span
      className={cn(
        "inline-block rounded-full bg-current",
        dim,
        colorFor[status],
        status === "running" && "pulse-dot",
      )}
      aria-label={status}
    />
  );
}
