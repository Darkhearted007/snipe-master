import { Skeleton } from "@/components/ui/skeleton";

/** Lightweight, non-blocking skeleton that mimics the dashboard chrome
 *  while the auth session resolves. Avoids a full-screen "Loading…" flash. */
export function AppShellSkeleton() {
  return (
    <div className="flex min-h-screen w-full bg-background" aria-busy="true" aria-live="polite">
      {/* Sidebar */}
      <aside className="hidden w-56 shrink-0 border-r border-border/60 p-3 md:block">
        <Skeleton className="mb-4 h-8 w-32" />
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <div className="flex items-center gap-3">
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-6 w-16" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-8 w-32" />
          </div>
        </header>

        {/* Status strip */}
        <div className="flex gap-3 border-b border-border/60 px-4 py-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-24" />
          ))}
        </div>

        {/* Main grid */}
        <main className="grid flex-1 gap-4 p-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border/60 p-4">
              <Skeleton className="mb-3 h-5 w-32" />
              <Skeleton className="mb-2 h-4 w-full" />
              <Skeleton className="mb-2 h-4 w-3/4" />
              <Skeleton className="h-24 w-full" />
            </div>
          ))}
        </main>
      </div>
    </div>
  );
}
