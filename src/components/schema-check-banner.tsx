import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, X } from "lucide-react";
import { checkDiscoverySchema, type SchemaCheckResult } from "@/lib/schema-check.functions";

export function SchemaCheckBanner() {
  const run = useServerFn(checkDiscoverySchema);
  const [result, setResult] = useState<SchemaCheckResult | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    run()
      .then((r) => {
        if (!cancelled) setResult(r);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setResult({
            ok: false,
            tableExists: false,
            functionExists: false,
            error: e instanceof Error ? e.message : String(e),
            errorKind: "unknown",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [run]);

  if (!result || result.ok || dismissed) return null;

  const missing: string[] = [];
  if (!result.tableExists) missing.push("public.discovery_candidates table");
  if (!result.functionExists) missing.push("prune_stale_discovery_candidates() function");

  const headline =
    result.errorKind === "network" || result.errorKind === "backend_unreachable"
      ? "Discovery backend unreachable"
      : result.errorKind === "config_missing"
        ? "Discovery backend misconfigured"
        : result.errorKind === "permission"
          ? "Discovery access blocked"
          : result.errorKind === "table_missing"
            ? "Discovery storage missing"
            : "Discovery check failed";

  const detail =
    result.errorKind === "network" || result.errorKind === "backend_unreachable"
      ? "Supabase is unavailable right now. The app will fall back to DexScreener/Raydium polling, but discovery persistence is degraded until the backend recovers."
      : result.errorKind === "config_missing"
        ? "Supabase environment variables are missing or invalid. Discovery will fall back to DexScreener/Raydium polling until the backend is configured."
        : result.errorKind === "permission"
          ? "Discovery is reachable but access is blocked. Check service-role access and row-level policies."
          : result.errorKind === "table_missing"
            ? `Discovery storage is missing — ${missing.join(" and ")}. The app will continue with fallback discovery, but database persistence needs the pending migration.`
            : `Discovery check failed — ${missing.join(" and ") || "required schema access"}. Fallback discovery remains active.`;

  return (
    <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="flex-1">
          <div className="font-semibold">{headline}</div>
          <div className="mt-0.5 text-amber-200/80">
            {detail}
            {result.error ? <span className="ml-1 opacity-70">({result.error})</span> : null}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="rounded p-0.5 text-amber-200/70 hover:bg-amber-500/20 hover:text-amber-100"
          aria-label="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}