// Structured logging + toast layer for non-fatal runtime failures.
// - Writes an audit entry into the bot log (persisted → Cloud).
// - Reports to Lovable's captureException with rich context.
// - Surfaces a user-visible sonner toast, throttled per category so a
//   flapping stream can't spam the UI.
import { toast } from "sonner";
import { useBotStore } from "@/lib/bot-store";
import { reportLovableError } from "@/lib/lovable-error-reporting";

export type LogCategory =
  "stream" | "persistence" | "wallet" | "swap" | "rpc" | "boundary" | "unknown";

export type LogSeverity = "info" | "warning" | "error";

type Options = {
  category: LogCategory;
  severity?: LogSeverity;
  userMessage?: string; // human copy for the toast
  context?: Record<string, unknown>;
  silent?: boolean; // skip toast (still logs + reports)
};

const TOAST_THROTTLE_MS = 15_000;
const lastToastAt: Partial<Record<LogCategory, number>> = {};

function toastFor(category: LogCategory, severity: LogSeverity, message: string) {
  const now = Date.now();
  const prev = lastToastAt[category] ?? 0;
  if (now - prev < TOAST_THROTTLE_MS) return;
  lastToastAt[category] = now;
  if (severity === "error") toast.error(message);
  else if (severity === "warning") toast.warning(message);
  else toast(message);
}

export function logStructured(error: unknown, opts: Options) {
  const severity = opts.severity ?? "error";
  const err =
    error instanceof Error ? error : new Error(typeof error === "string" ? error : "Unknown error");
  const summary = `[${opts.category}] ${err.message}`;

  // 1) In-app audit log (also flushed to Cloud by useServerPersistence)
  try {
    useBotStore.getState().logAudit(summary, severity === "error" ? "error" : "audit");
  } catch {
    /* store may not be ready during boot */
  }

  // 2) Structured console line for devtools / worker logs
  const line = {
    category: opts.category,
    severity,
    message: err.message,
    ...opts.context,
  };
  if (severity === "error") console.error("[app]", line, err);
  else if (severity === "warning") console.warn("[app]", line);
  else console.info("[app]", line);

  // 3) Report to Lovable error pipeline (browser-only)
  reportLovableError(err, { category: opts.category, severity, ...opts.context });

  // 4) User-visible toast (throttled)
  if (!opts.silent) {
    const msg = opts.userMessage ?? defaultCopy(opts.category, severity);
    toastFor(opts.category, severity, msg);
  }
}

function defaultCopy(category: LogCategory, severity: LogSeverity) {
  const prefix = severity === "error" ? "Error" : severity === "warning" ? "Warning" : "Notice";
  switch (category) {
    case "stream":
      return `${prefix}: live market stream disrupted — auto-reconnecting`;
    case "persistence":
      return `${prefix}: couldn't sync to cloud — will retry`;
    case "wallet":
      return `${prefix}: wallet operation failed`;
    case "swap":
      return `${prefix}: swap execution failed`;
    case "rpc":
      return `${prefix}: RPC request failed`;
    case "boundary":
      return `${prefix}: the page hit an unexpected error`;
    default:
      return `${prefix}: unexpected issue`;
  }
}
