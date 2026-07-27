import { AlertTriangle, RefreshCw } from "lucide-react";

/**
 * Rendered instead of the app shell when required Supabase env vars are
 * missing. Prevents the "This section stopped responding" relapse loop by
 * short-circuiting BEFORE any hook touches the supabase client.
 */
export function ConfigErrorScreen({ missing }: { missing: string[] }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-lg rounded-lg border border-destructive/40 bg-card p-6 shadow-lg">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-destructive" />
          <div className="space-y-3">
            <div>
              <h1 className="text-lg font-semibold text-foreground">
                Backend configuration missing
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                The app can’t start because required backend environment variables were not injected
                into the client bundle.
              </p>
            </div>

            <div className="rounded border border-border bg-muted/30 p-3 font-mono text-xs">
              {missing.map((m) => (
                <div key={m} className="text-destructive">
                  ✗ VITE_{m}
                </div>
              ))}
            </div>

            <div className="space-y-2 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Next steps</p>
              <ol className="ml-4 list-decimal space-y-1">
                <li>Confirm Lovable Cloud is enabled for this project.</li>
                <li>
                  Reload the preview — a fresh build usually re-injects the values into the client
                  bundle.
                </li>
                <li>
                  If the message keeps returning, restart the dev server so Vite re-reads
                  <code className="mx-1 rounded bg-muted px-1">.env</code>.
                </li>
              </ol>
            </div>

            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <RefreshCw className="h-4 w-4" />
              Reload
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
