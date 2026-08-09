// Provides the active Sniper Signer (burner-key auto-signing) to the whole
// execution layer. When the user has armed a signer in the store, every
// consumer of useSniperSigner() gets a wallet-adapter-compatible signer and
// should use it INSTEAD of the browser wallet extension. When unset, the
// wallet adapter remains the signing path (Option B / manual popups).
//
// Must be mounted inside SolanaProviders, above the executor mounts.
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useBotStore } from "@/lib/bot-store";
import { sniperSignerFromSecretKey, type SniperSigner } from "@/lib/sniper-signer";

interface SniperSignerContextValue {
  /** The active burner signer, or null when the wallet adapter is in charge. */
  signer: SniperSigner | null;
}

const SniperSignerContext = createContext<SniperSignerContextValue>({ signer: null });

export function SniperSignerProvider({ children }: { children: ReactNode }) {
  const secretKey = useBotStore((s) => s.sniperSecretKey);

  const signer = useMemo<SniperSigner | null>(() => {
    if (!secretKey) return null;
    const parsed = sniperSignerFromSecretKey(secretKey);
    return parsed.ok ? parsed.signer : null;
  }, [secretKey]);

  const value = useMemo(() => ({ signer }), [signer]);

  return <SniperSignerContext.Provider value={value}>{children}</SniperSignerContext.Provider>;
}

export function useSniperSigner(): SniperSignerContextValue {
  return useContext(SniperSignerContext);
}
