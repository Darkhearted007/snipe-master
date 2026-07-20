import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  findServiceRoleInText,
  scanBrowserStorage,
} from "@/lib/service-role-detector";
import { logStructured } from "@/lib/structured-logger";

type Detection =
  | { source: "paste"; where: string }
  | { source: "input"; where: string }
  | { source: "storage"; where: string };

/** Persistent warning shown when a Supabase service_role JWT is detected in
 *  any client-reachable surface. The key is never sent to the server. */
export function ServiceRoleWarning() {
  const [detection, setDetection] = useState<Detection | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // 1) One-shot scan of browser storage on mount.
    const hit = scanBrowserStorage();
    if (hit) {
      setDetection({ source: "storage", where: `${hit.store}: "${hit.key}"` });
      logStructured(new Error("service_role key detected in browser storage"), {
        category: "wallet",
        severity: "error",
        silent: true,
        context: { store: hit.store, key: hit.key },
      });
    }

    // 2) Paste listener — catches keys pasted into any input/textarea/contenteditable.
    const onPaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData("text") ?? "";
      if (findServiceRoleInText(text)) {
        const target = e.target as HTMLElement | null;
        const where =
          target?.tagName?.toLowerCase() +
          (target?.getAttribute("name") ? `[name=${target.getAttribute("name")}]` : "");
        setDetection({ source: "paste", where: where || "unknown field" });
        setDismissed(false);
        logStructured(new Error("service_role key pasted into UI"), {
          category: "wallet",
          severity: "error",
          silent: true,
          context: { where },
        });
      }
    };

    // 3) Input listener — catches programmatic setValue or drop.
    const onInput = (e: Event) => {
      const target = e.target as HTMLInputElement | HTMLTextAreaElement | null;
      if (!target || !("value" in target)) return;
      const val = target.value ?? "";
      if (findServiceRoleInText(val)) {
        setDetection({
          source: "input",
          where: target.tagName.toLowerCase() +
            (target.getAttribute("name") ? `[name=${target.getAttribute("name")}]` : ""),
        });
        setDismissed(false);
      }
    };

    window.addEventListener("paste", onPaste, true);
    window.addEventListener("input", onInput, true);
    return () => {
      window.removeEventListener("paste", onPaste, true);
      window.removeEventListener("input", onInput, true);
    };
  }, []);

  if (!detection || dismissed) return null;

  return (
    <div className="border-b border-danger/40 bg-danger/10 px-4 py-3">
      <Alert variant="destructive" className="border-danger/40 bg-transparent">
        <AlertTriangle className="h-4 w-4" />
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <AlertTitle className="text-sm font-semibold">
              Supabase service_role key detected — rotate now
            </AlertTitle>
            <AlertDescription className="mt-1 space-y-1 text-xs">
              <p>
                A <span className="font-mono">service_role</span> JWT was found in{" "}
                <span className="font-mono">{detection.where}</span> ({detection.source}).
                This key has full admin access and bypasses RLS. Treat it as compromised.
              </p>
              <ol className="ml-4 list-decimal space-y-0.5">
                <li>Open your Supabase project → Settings → API.</li>
                <li>
                  Click <span className="font-mono">Rotate service_role secret</span>.
                </li>
                <li>Update any server-side integrations using the old key.</li>
                <li>
                  Never paste service_role into the browser, chat, or client code — it belongs
                  only in server-side secrets.
                </li>
              </ol>
            </AlertDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 gap-1 text-xs"
            onClick={() => setDismissed(true)}
          >
            <X className="h-3 w-3" /> Dismiss
          </Button>
        </div>
      </Alert>
    </div>
  );
}
