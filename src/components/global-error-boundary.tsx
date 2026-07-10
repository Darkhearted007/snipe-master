import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { logStructured } from "@/lib/structured-logger";

type Props = { children: ReactNode; fallbackTitle?: string };
type State = { error: Error | null };

/** App-wide error boundary. Catches renders errors inside the shell that the
 *  router-level errorComponent doesn't see (provider trees, event-triggered
 *  renders). Reports via structured logger and shows a recovery UI. */
export class GlobalErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logStructured(error, {
      category: "boundary",
      severity: "error",
      context: { componentStack: info.componentStack ?? undefined },
      userMessage: "Something crashed — the page has been isolated",
    });
  }

  private reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-[60vh] items-center justify-center bg-background px-4">
        <div className="max-w-md text-center">
          <h1 className="text-lg font-semibold text-foreground">
            {this.props.fallbackTitle ?? "This section stopped responding"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The error has been reported. You can retry, or refresh the page.
          </p>
          <pre className="mt-4 max-h-32 overflow-auto rounded border bg-muted/40 p-2 text-left text-[10px] text-muted-foreground">
            {this.state.error.message}
          </pre>
          <div className="mt-4 flex justify-center gap-2">
            <Button size="sm" onClick={this.reset}>
              Try again
            </Button>
            <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
              Reload
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
