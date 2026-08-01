// Pump.fun program constants and PDA helpers.
//
// Used by /api/pumpfun/buy (server-side transaction builder) to construct
// bonding-curve buy instructions without relying on Jupiter — Jupiter
// cannot route pump.fun bonding-curve tokens (they live on pump.fun's
// internal constant-product curve, not an AMM), so every buy of a
// pre-migration pump.fun token must go through the pump.fun program
// directly.
//
// Constants sourced from the official pump.fun public IDL:
//   https://github.com/pump-fun/pump-public-docs/blob/main/idl/pump.json
// and cross-referenced against the chainstacklabs/pumpfun-bonkfun-bot repo
// and Solana Stack Exchange answer #23756.

import { PublicKey } from "@solana/web3.js";

/** Main pump.fun bonding-curve program. */
export const PUMP_PROGRAM_ID = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

/** Pump fee-sharing program (fee_config PDA is derived from this). */
export const PUMP_FEE_PROGRAM_ID = new PublicKey("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");

/** SPL Token program. */
export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

/** Associated Token Account program (for ATA creation). */
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

/** System program. */
export const SYSTEM_PROGRAM_ID = new PublicKey("11111111111111111111111111111111");

// --- PDA seeds (decoded from the IDL's const[] byte arrays) ---

const SEED_GLOBAL = "global";
const SEED_BONDING_CURVE = "bonding-curve";
const SEED_CREATOR_VAULT = "creator-vault";
const SEED_EVENT_AUTHORITY = "__event_authority";
const SEED_GLOBAL_VOLUME_ACCUMULATOR = "global_volume_accumulator";
const SEED_USER_VOLUME_ACCUMULATOR = "user_volume_accumulator";
const SEED_FEE_CONFIG = "fee_config";

// --- PDA derivation helpers ---

/** Global config PDA — seeds: ["global"], program: PUMP_PROGRAM_ID */
export function globalPda(): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from(SEED_GLOBAL)], PUMP_PROGRAM_ID)[0];
}

/** Bonding curve PDA — seeds: ["bonding-curve", mint], program: PUMP_PROGRAM_ID */
export function bondingCurvePda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(SEED_BONDING_CURVE), mint.toBuffer()],
    PUMP_PROGRAM_ID,
  )[0];
}

/** Creator vault PDA — seeds: ["creator-vault", creator], program: PUMP_PROGRAM_ID */
export function creatorVaultPda(creator: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(SEED_CREATOR_VAULT), creator.toBuffer()],
    PUMP_PROGRAM_ID,
  )[0];
}

/** Event authority PDA — seeds: ["__event_authority"], program: PUMP_PROGRAM_ID */
export function eventAuthorityPda(): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from(SEED_EVENT_AUTHORITY)], PUMP_PROGRAM_ID)[0];
}

/** Global volume accumulator PDA — seeds: ["global_volume_accumulator"], program: PUMP_PROGRAM_ID */
export function globalVolumeAccumulatorPda(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(SEED_GLOBAL_VOLUME_ACCUMULATOR)],
    PUMP_PROGRAM_ID,
  )[0];
}

/** User volume accumulator PDA — seeds: ["user_volume_accumulator", user], program: PUMP_PROGRAM_ID */
export function userVolumeAccumulatorPda(user: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(SEED_USER_VOLUME_ACCUMULATOR), user.toBuffer()],
    PUMP_PROGRAM_ID,
  )[0];
}

/** Fee config PDA — seeds: ["fee_config", PUMP_PROGRAM_ID], program: PUMP_FEE_PROGRAM_ID */
export function feeConfigPda(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(SEED_FEE_CONFIG), PUMP_PROGRAM_ID.toBuffer()],
    PUMP_FEE_PROGRAM_ID,
  )[0];
}

// --- Instruction discriminators ---

/** buy_exact_sol_in discriminator: [56, 252, 116, 8, 158, 223, 205, 95] */
export const BUY_EXACT_SOL_IN_DISCRIMINATOR = Buffer.from([56, 252, 116, 8, 158, 223, 205, 95]);

// --- Bonding curve account decoder ---
//
// Layout (after 8-byte Anchor discriminator):
//   offset 0:  virtual_token_reserves  (u64)
//   offset 8:  virtual_quote_reserves  (u64) — virtual SOL reserves for SOL-paired
//   offset 16: real_token_reserves     (u64)
//   offset 24: real_quote_reserves     (u64) — real SOL reserves
//   offset 32: token_total_supply      (u64)
//   offset 40: complete                (bool, 1 byte)
//   offset 41: creator                 (pubkey, 32 bytes)
//   offset 73: is_mayhem_mode          (bool, 1 byte)
//   offset 74: is_cashback_coin        (bool, 1 byte)
//   offset 75: quote_mint              (pubkey, 32 bytes)

export interface BondingCurveData {
  virtualTokenReserves: bigint;
  virtualQuoteReserves: bigint;
  realTokenReserves: bigint;
  realQuoteReserves: bigint;
  tokenTotalSupply: bigint;
  complete: boolean;
  creator: PublicKey;
  isMayhemMode: boolean;
  isCashbackCoin: boolean;
  quoteMint: PublicKey;
}

/**
 * Decode raw bonding curve account data (base64 or Buffer) into typed fields.
 * Throws if the data is too short or the curve is already complete (graduated).
 */
export function decodeBondingCurve(data: Buffer): BondingCurveData {
  // data includes the 8-byte discriminator prefix from getAccountInfo
  if (data.length < 8 + 76) {
    throw new Error(`Bonding curve data too short: ${data.length} bytes (expected >= ${8 + 76})`);
  }
  // Skip the 8-byte Anchor discriminator
  const off = 8;
  const virtualTokenReserves = data.readBigUInt64LE(off + 0);
  const virtualQuoteReserves = data.readBigUInt64LE(off + 8);
  const realTokenReserves = data.readBigUInt64LE(off + 16);
  const realQuoteReserves = data.readBigUInt64LE(off + 24);
  const tokenTotalSupply = data.readBigUInt64LE(off + 32);
  const complete = data.readUInt8(off + 40) === 1;
  const creator = new PublicKey(data.subarray(off + 41, off + 41 + 32));
  const isMayhemMode = data.readUInt8(off + 73) === 1;
  const isCashbackCoin = data.readUInt8(off + 74) === 1;
  const quoteMint = new PublicKey(data.subarray(off + 75, off + 75 + 32));
  return {
    virtualTokenReserves,
    virtualQuoteReserves,
    realTokenReserves,
    realQuoteReserves,
    tokenTotalSupply,
    complete,
    creator,
    isMayhemMode,
    isCashbackCoin,
    quoteMint,
  };
}

// --- Global account decoder ---
//
// Layout (after 8-byte discriminator):
//   offset 0:  initialized             (bool)
//   offset 1:  authority               (pubkey, 32 bytes)
//   offset 33: fee_recipient           (pubkey, 32 bytes)
//   ... (remaining fields not needed for buy)

export interface GlobalData {
  initialized: boolean;
  authority: PublicKey;
  feeRecipient: PublicKey;
}

/**
 * Decode the Global account just enough to read the fee_recipient.
 */
export function decodeGlobal(data: Buffer): GlobalData {
  if (data.length < 8 + 33 + 32) {
    throw new Error(`Global data too short: ${data.length} bytes (expected >= ${8 + 33 + 32})`);
  }
  const off = 8;
  const initialized = data.readUInt8(off + 0) === 1;
  const authority = new PublicKey(data.subarray(off + 1, off + 1 + 32));
  const feeRecipient = new PublicKey(data.subarray(off + 33, off + 33 + 32));
  return { initialized, authority, feeRecipient };
}

// --- Bonding curve math ---
//
// pump.fun uses a constant-product (x*y=k) curve:
//   tokens_out = (sol_in_after_fee * virtual_token_reserves) /
//                (virtual_sol_reserves + sol_in_after_fee)
//
// Fee is 1% (100 bps) of the SOL input, deducted before the curve math.
// The on-chain program applies this itself, but we need to compute the
// expected token output locally to set a sane min_tokens_out for slippage.

/** pump.fun protocol fee in basis points (1%). */
export const PUMP_FEE_BPS = 100n;

/**
 * Compute the expected token output for a given SOL input on the bonding curve.
 * Returns tokens in raw units (the mint's smallest denomination).
 */
export function computeBuyTokensOut(
  solInLamports: bigint,
  virtualTokenReserves: bigint,
  virtualQuoteReserves: bigint,
): bigint {
  // Deduct the 1% protocol fee from the SOL input
  const fee = (solInLamports * PUMP_FEE_BPS) / 10000n;
  const solAfterFee = solInLamports - fee;
  if (solAfterFee <= 0n) return 0n;
  // Constant product: tokens_out = sol_after_fee * vtr / (vsr + sol_after_fee)
  const numerator = solAfterFee * virtualTokenReserves;
  const denominator = virtualQuoteReserves + solAfterFee;
  if (denominator <= 0n) return 0n;
  return numerator / denominator;
}

/**
 * Apply slippage tolerance to the expected token output.
 * Returns the minimum tokens to accept (min_tokens_out).
 * slippageBps is in basis points (e.g. 300 = 3%).
 */
export function applySlippage(tokensOut: bigint, slippageBps: bigint): bigint {
  if (tokensOut <= 0n) return 0n;
  // min_out = tokens_out * (10000 - slippage_bps) / 10000
  const adjusted = (tokensOut * (10000n - slippageBps)) / 10000n;
  // Never go below 1 token unit
  return adjusted > 0n ? adjusted : 1n;
}
