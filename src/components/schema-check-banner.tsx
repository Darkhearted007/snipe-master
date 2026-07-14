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

  return (
    <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="flex-1">
          <div className="font-semibold">Database migration pending</div>
          <div className="mt-0.5 text-amber-200/80">
            Discovery is offline — missing {missing.join(" and ")}. Run the pending migration to
            restore token discovery.
            {result.error ? (
              <span className="ml-1 opacity-70">({result.error})</span>
            ) : null}
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
