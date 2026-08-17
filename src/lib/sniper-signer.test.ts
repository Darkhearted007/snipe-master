import { describe, expect, test } from "vitest";
import { Keypair } from "@solana/web3.js";
import {
  generateSniperKeypair,
  parseSniperSecretKey,
  secretKeyToBase58,
  sniperSignerFromKeypair,
} from "./sniper-signer";

describe("parseSniperSecretKey", () => {
  test("rejects empty input", () => {
    expect(parseSniperSecretKey("   ").ok).toBe(false);
  });

  test("rejects invalid base58", () => {
    expect(parseSniperSecretKey("not-a-valid-key!!").ok).toBe(false);
  });

  test("rejects a 32-byte public key (must be the full 64-byte secret)", () => {
    const kp = Keypair.generate();
    expect(parseSniperSecretKey(kp.publicKey.toBase58()).ok).toBe(false);
  });

  test("round-trips a generated keypair through base58", () => {
    const kp = generateSniperKeypair();
    const parsed = parseSniperSecretKey(secretKeyToBase58(kp));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.keypair.publicKey.toBase58()).toBe(kp.publicKey.toBase58());
    }
  });
});

describe("sniperSignerFromKeypair", () => {
  test("exposes the keypair's address", () => {
    const kp = generateSniperKeypair();
    const signer = sniperSignerFromKeypair(kp);
    expect(signer.address).toBe(kp.publicKey.toBase58());
    expect(signer.publicKey.toBase58()).toBe(kp.publicKey.toBase58());
  });
});
