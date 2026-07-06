import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";

export const Route = createFileRoute("/watchlist")({
  head: () => ({ meta: [{ title: "Watchlist — SniperBot" }] }),
  component: WatchlistPage,
});

const seed = ["SOL/USDC", "BONK/SOL", "WIF/SOL", "JUP/USDC", "PYTH/SOL"];

function WatchlistPage() {
  const [items, setItems] = useState(seed);
  const [input, setInput] = useState("");
  const [auto, setAuto] = useState(true);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">
            Curated Solana universe
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-md border bg-muted/40 p-3">
            <div>
              <Label htmlFor="auto" className="text-sm">
                Automated watchlist selection
              </Label>
              <p className="text-xs text-muted-foreground">
                Let the strategy engine curate additions.
              </p>
            </div>
            <Switch id="auto" checked={auto} onCheckedChange={setAuto} />
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="TOKEN/QUOTE"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="font-mono"
            />
            <Button
              onClick={() => {
                if (input.trim()) {
                  setItems([...items, input.trim().toUpperCase()]);
                  setInput("");
                }
              }}
            >
              Add
            </Button>
          </div>
          <ul className="space-y-1">
            {items.map((it) => (
              <li
                key={it}
                className="flex items-center justify-between rounded-md border px-3 py-2"
              >
                <span className="font-mono text-sm">{it}</span>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setItems(items.filter((x) => x !== it))}
                >
                  <X className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">About live mode</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            In <Badge className="bg-live text-live-foreground">LIVE</Badge> mode
            the executor only trades tokens on this list. Paper mode ignores the
            watchlist and scans the full opportunity feed.
          </p>
          <p>
            Automated selection uses safety score + confidence rolling averages
            to promote tokens after 5 consecutive positive decisions.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
