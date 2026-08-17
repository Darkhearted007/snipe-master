// Sniper Signer — optional burner-key signing for live mode.
//
// The rest of the bot only ever talks to a wallet through the adapter's
// `signTransaction` interface (see useLiveExecution / useAutoExecutor).
// This module builds a drop-in replacement backed by a local Solana
// Keypair, so buys and sells sign in milliseconds with NO browser wallet
// popup — the bot can run fully unattended.
//
// SECURITY MODEL (read before using):
//   • Only ever use a DEDICATED burner wallet that holds a small balance
//     you are willing to lose on a single run. Never import your main
//     Phantom/Solflare key.
//   • The secret key is stored in the app's localStorage so it survives
//     reloads. Anyone with script access to this browser (XSS, compromised
//     dependency) could sign transactions from that wallet — which is
//     exactly why it must hold only a small, isolated balance.
//   • The key never leaves the browser and never touches the server. The
//     swap transaction builders are already client-side.
import { Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";

/** A wallet-adapter-compatible signer backed by a local keypair. */
export interface SniperSigner {
  address: string;
  publicKey: PublicKey;
  signTransaction: (tx: VersionedTransaction) => Promise<VersionedTransaction>;
  signAllTransactions: (txs: VersionedTransaction[]) => Promise<VersionedTransaction[]>;
}

/** Validate + decode a base58 secret key (must be the full 64-byte key). */
export function parseSniperSecretKey(
  secretKeyBase58: string,
): { ok: true; keypair: Keypair } | { ok: false; error: string } {
  const clean = secretKeyBase58.trim();
  if (!clean) return { ok: false, error: "Paste a base58 secret key" };
  try {
    const bytes = bs58.decode(clean);
    if (bytes.length !== 64) {
      return {
        ok: false,
        error:
          "Secret key must decode to 64 bytes (the full base58 private key, not just the 32-byte half)",
      };
    }
    return { ok: true, keypair: Keypair.fromSecretKey(bytes) };
  } catch {
    return { ok: false, error: "Not a valid base58 secret key" };
  }
}

/** Create a fresh burner keypair. Caller must back up the secret key. */
export function generateSniperKeypair(): Keypair {
  return Keypair.generate();
}

/** Wrap a keypair in the adapter-compatible signer interface. */
export function sniperSignerFromKeypair(keypair: Keypair): SniperSigner {
  return {
    address: keypair.publicKey.toBase58(),
    publicKey: keypair.publicKey,
    // Sign with the keypair directly — milliseconds, no popup. Mutates and
    // returns the same transaction, matching the adapter's contract.
    signTransaction: (tx) => {
      tx.sign([keypair]);
      return Promise.resolve(tx);
    },
    signAllTransactions: (txs) => {
      for (const t of txs) t.sign([keypair]);
      return Promise.resolve(txs);
    },
  };
}

/** Build a signer from a base58 secret key string, or return an error. */
export function sniperSignerFromSecretKey(
  secretKeyBase58: string,
): { ok: true; signer: SniperSigner } | { ok: false; error: string } {
  const parsed = parseSniperSecretKey(secretKeyBase58);
  if (!parsed.ok) return parsed;
  return { ok: true, signer: sniperSignerFromKeypair(parsed.keypair) };
}

/** Encode a keypair's secret key as base58 (for backup/copy). */
export function secretKeyToBase58(keypair: Keypair): string {
  return bs58.encode(keypair.secretKey);
}
