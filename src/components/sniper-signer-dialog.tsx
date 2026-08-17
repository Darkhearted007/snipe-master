import { useState } from "react";
import { AlertTriangle, Copy, KeyRound, Plus, ShieldOff, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useBotStore } from "@/lib/bot-store";
import { generateSniperKeypair, secretKeyToBase58 } from "@/lib/sniper-signer";

function shortAddr(a: string) {
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}

export function SniperSignerDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const secretKey = useBotStore((s) => s.sniperSecretKey);
  const setSniperSigner = useBotStore((s) => s.setSniperSigner);
  const walletAddress = useBotStore((s) => s.walletAddress);
  const walletBalanceSol = useBotStore((s) => s.walletBalanceSol);

  const [importValue, setImportValue] = useState("");
  const [generatedSecret, setGeneratedSecret] = useState<string | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);

  const activeAddress = secretKey ? walletAddress : null;

  const handleImport = () => {
    const res = setSniperSigner(importValue);
    if (!res.ok) {
      toast.error("Invalid secret key", { description: res.error });
      return;
    }
    setImportValue("");
    toast.success("Sniper Signer armed", {
      description: `${shortAddr(res.address ?? "")} · buys/sells now sign with no popups`,
    });
  };

  const handleGenerate = () => {
    const keypair = generateSniperKeypair();
    const base58 = secretKeyToBase58(keypair);
    const res = setSniperSigner(base58);
    if (!res.ok) {
      toast.error("Failed to arm signer", { description: res.error });
      return;
    }
    setGeneratedSecret(base58);
    toast.success("Burner wallet created", {
      description: `${shortAddr(res.address ?? "")} · back up the key below`,
    });
  };

  const handleWipe = () => {
    setSniperSigner(null);
    setGeneratedSecret(null);
    setConfirmWipe(false);
    toast("Sniper Signer removed", { description: "Wallet popup signing restored." });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) setConfirmWipe(false);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-warning" /> Sniper Signer
          </DialogTitle>
          <DialogDescription>
            Burner-key auto-signing: buys and sells execute instantly with no wallet popups, so the
            bot can run unattended.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-2.5 text-[11px] text-warning">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Use a <b>dedicated burner wallet</b> holding only what you're willing to lose. Anyone
              with access to this browser can sign from it. Never paste your main Phantom/Solflare
              key.
            </span>
          </div>

          {activeAddress ? (
            <div className="space-y-3">
              <div className="rounded-md border bg-muted/30 p-3">
                <div className="flex items-center justify-between">
                  <Badge className="bg-warning text-warning-foreground">auto-sign armed</Badge>
                  <span className="font-mono text-xs text-foreground">
                    {shortAddr(activeAddress)}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>Balance</span>
                  <span className="font-mono text-foreground">
                    {walletBalanceSol == null ? "—" : `${walletBalanceSol.toFixed(4)} SOL`}
                  </span>
                </div>
                <div className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
                  {activeAddress}
                </div>
              </div>
              {generatedSecret && (
                <div className="space-y-1.5 rounded-md border border-warning/40 bg-warning/5 p-2.5">
                  <Label className="text-[11px] text-warning">
                    New key — back this up now, it's shown once
                  </Label>
                  <div className="break-all rounded border bg-background p-2 font-mono text-[10px]">
                    {generatedSecret}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 text-xs"
                    onClick={() => {
                      void navigator.clipboard.writeText(generatedSecret);
                      toast("Secret key copied");
                    }}
                  >
                    <Copy className="h-3 w-3" /> Copy
                  </Button>
                </div>
              )}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1 text-xs"
                  onClick={() => {
                    void navigator.clipboard.writeText(activeAddress);
                    toast("Address copied");
                  }}
                >
                  <Copy className="h-3 w-3" /> Copy address
                </Button>
                <div className="ml-auto" />
                {confirmWipe ? (
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-8 gap-1 text-xs"
                    onClick={handleWipe}
                  >
                    <Trash2 className="h-3 w-3" /> Confirm wipe
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1 text-xs text-danger"
                    onClick={() => setConfirmWipe(true)}
                  >
                    <ShieldOff className="h-3 w-3" /> Wipe signer
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="sniper-secret" className="text-xs">
                  Import a burner secret key (base58)
                </Label>
                <Textarea
                  id="sniper-secret"
                  value={importValue}
                  onChange={(e) => setImportValue(e.target.value)}
                  placeholder="Paste the 64-byte base58 secret key…"
                  className="h-20 font-mono text-xs"
                />
                <Button
                  size="sm"
                  className="w-full gap-1.5"
                  onClick={handleImport}
                  disabled={!importValue.trim()}
                >
                  <KeyRound className="h-3.5 w-3.5" /> Import key
                </Button>
              </div>
              <div className="relative text-center">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <span className="relative bg-popover px-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                  or
                </span>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="w-full gap-1.5"
                onClick={handleGenerate}
              >
                <Plus className="h-3.5 w-3.5" /> Generate new burner wallet
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
