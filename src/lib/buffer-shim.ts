// Browser Buffer polyfill for Solana wallet adapters + web3.js.
// Imported eagerly at the top of every client chunk that could touch
// @solana/*: router.tsx (client entry) and solana-provider-client.tsx
// (dynamic-imported wallet chunk).
import { Buffer } from "buffer";

if (typeof globalThis !== "undefined") {
  const g = globalThis as unknown as {
    Buffer?: typeof Buffer;
    global?: unknown;
    process?: { env?: Record<string, string> };
  };
  if (!g.Buffer) g.Buffer = Buffer;
  if (!g.global) g.global = globalThis;
  // Some wallet-adapter code reads process.env.NODE_ENV.
  if (!g.process) g.process = { env: {} };
  else if (!g.process.env) g.process.env = {};
}

if (typeof window !== "undefined") {
  const w = window as unknown as { Buffer?: typeof Buffer };
  if (!w.Buffer) w.Buffer = Buffer;
}
