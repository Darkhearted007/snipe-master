import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useBotStore } from "@/lib/bot-store";
import { cn } from "@/lib/utils";

export function PositionsCard() {
  const positions = useBotStore((s) => s.positions);
  const close = useBotStore((s) => s.closePosition);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Open Positions</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Token</TableHead>
              <TableHead>Venue</TableHead>
              <TableHead className="text-right">Size</TableHead>
              <TableHead className="text-right">P&L</TableHead>
              <TableHead className="text-right">TP / SL</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {positions.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-xs text-muted-foreground">
                  No open positions
                </TableCell>
              </TableRow>
            )}
            {positions.map((p) => {
              const pnl = (p.current - p.entry) * (p.sizeSol / p.entry);
              const pct = (p.current / p.entry - 1) * 100;
              return (
                <TableRow key={p.id}>
                  <TableCell className="font-mono text-xs font-semibold">{p.token}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px] uppercase">
                      {p.venue}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {p.sizeSol.toFixed(5)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-mono text-xs",
                      pnl >= 0 ? "text-success" : "text-danger",
                    )}
                  >
                    {pnl >= 0 ? "+" : ""}
                    {pnl.toFixed(5)}
                    <div className="text-[10px] opacity-70">
                      {pct >= 0 ? "+" : ""}
                      {pct.toFixed(2)}%
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono text-[10px] text-muted-foreground">
                    <div className="text-success">{p.tp.toFixed(2)}x</div>
                    <div className="text-danger">{p.sl.toFixed(2)}x</div>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => close(p.id)}>
                      Close
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
