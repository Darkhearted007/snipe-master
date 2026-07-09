// Browser Buffer polyfill for Solana wallet adapters + web3.js.
// Must load before any @solana/* module executes. Imported at the very
// top of src/routes/__root.tsx so it runs during the client bundle boot.
import { Buffer } from "buffer";

if (typeof globalThis !== "undefined") {
  const g = globalThis as unknown as { Buffer?: typeof Buffer; global?: unknown };
  if (!g.Buffer) g.Buffer = Buffer;
  if (!g.global) g.global = globalThis;
}
