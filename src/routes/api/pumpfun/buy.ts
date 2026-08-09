import { createFileRoute } from "@tanstack/react-router";
import {
  PublicKey,
  TransactionInstruction,
  VersionedTransaction,
  TransactionMessage,
  ComputeBudgetProgram,
  SystemProgram,
} from "@solana/web3.js";
import { rpcRequest } from "@/lib/solana-rpc-server";
import {
  PUMP_PROGRAM_ID,
  PUMP_FEE_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  globalPda,
  bondingCurvePda,
  creatorVaultPda,
  eventAuthorityPda,
  globalVolumeAccumulatorPda,
  userVolumeAccumulatorPda,
  feeConfigPda,
  BUY_EXACT_SOL_IN_DISCRIMINATOR,
  decodeBondingCurve,
  decodeGlobal,
  computeBuyTokensOut,
  applySlippage,
} from "@/lib/pumpfun-constants";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
} as const;

const LAMPORTS_PER_SOL = 1_000_000_000;

/**
 * Fetch an account's raw data via the server RPC proxy. Returns null if the
 * account doesn't exist (same pattern as checkMintAuthority in onchain-safety).
 */
async function fetchAccountData(address: PublicKey): Promise<Buffer | null> {
  const result = await rpcRequest<{ value: { data: [string, string] } | null }>("getAccountInfo", [
    address.toBase58(),
    { encoding: "base64" },
  ]);
  if (!result?.value?.data?.[0]) return null;
  return Buffer.from(result.value.data[0], "base64");
}

/**
 * Fetch the latest blockhash for transaction finalization. The client
 * signs and submits the tx, but we pre-build it with a blockhash so the
 * VersionedMessage is complete and the wallet only needs to add its signature.
 */
async function fetchRecentBlockhash(): Promise<{
  blockhash: string;
  blockHeight: bigint;
}> {
  const result = await rpcRequest<{ value: { blockhash: string; lastValidBlockHeight: number } }>(
    "getLatestBlockhash",
    [],
  );
  if (!result?.value?.blockhash) {
    throw new Error("Failed to fetch latest blockhash");
  }
  return {
    blockhash: result.value.blockhash,
    blockHeight: BigInt(result.value.lastValidBlockHeight),
  };
}

/**
 * Check if the user already has an Associated Token Account for the mint.
 * If not, we prepend a create-ATA instruction so the buy doesn't fail.
 */
async function userHasAta(user: PublicKey, mint: PublicKey): Promise<boolean> {
  const ata = getAssociatedTokenAddress(user, mint);
  const data = await fetchAccountData(ata);
  return data !== null;
}

/** Derive the Associated Token Account address for a (owner, mint) pair. */
function getAssociatedTokenAddress(owner: PublicKey, mint: PublicKey): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return ata;
}

/**
 * Build the pump.fun `buy_exact_sol_in` instruction.
 *
 * Account layout (from the official pump.fun IDL — buy_exact_sol_in, 16 accounts):
 *   [0]  global                    (readonly, PDA)
 *   [1]  fee_recipient             (writable)
 *   [2]  mint                      (readonly)
 *   [3]  bonding_curve             (writable, PDA)
 *   [4]  associated_bonding_curve  (writable, ATA of bonding_curve)
 *   [5]  associated_user           (writable, ATA of user)
 *   [6]  user                      (writable, signer)
 *   [7]  system_program            (readonly)
 *   [8]  token_program             (readonly)
 *   [9]  creator_vault             (writable, PDA)
 *   [10] event_authority           (readonly, PDA)
 *   [11] program                   (readonly, pump.fun program)
 *   [12] global_volume_accumulator (readonly, PDA)
 *   [13] user_volume_accumulator   (writable, PDA)
 *   [14] fee_config                (readonly, PDA from fee_program)
 *   [15] fee_program               (readonly)
 *
 * Args:
 *   spendable_sol_in: u64  — exact SOL to spend (lamports)
 *   min_tokens_out:   u64  — minimum tokens to receive (slippage guard)
 *   track_volume:     OptionBool — 1 byte (1 = Some(true), 0 = None)
 */
function buildBuyExactSolInInstruction(params: {
  user: PublicKey;
  mint: PublicKey;
  bondingCurve: PublicKey;
  associatedBondingCurve: PublicKey;
  associatedUser: PublicKey;
  feeRecipient: PublicKey;
  creator: PublicKey;
  spendableSolIn: bigint;
  minTokensOut: bigint;
}): TransactionInstruction {
  const {
    user,
    mint,
    bondingCurve,
    associatedBondingCurve,
    associatedUser,
    feeRecipient,
    creator,
    spendableSolIn,
    minTokensOut,
  } = params;

  const creatorVault = creatorVaultPda(creator);
  const eventAuthority = eventAuthorityPda();
  const globalVolumeAcc = globalVolumeAccumulatorPda();
  const userVolumeAcc = userVolumeAccumulatorPda(user);
  const feeConfig = feeConfigPda();

  // Instruction data: discriminator(8) + spendable_sol_in(8) + min_tokens_out(8) + track_volume(1)
  const data = Buffer.alloc(8 + 8 + 8 + 1);
  BUY_EXACT_SOL_IN_DISCRIMINATOR.copy(data, 0);
  data.writeBigUInt64LE(spendableSolIn, 8);
  data.writeBigUInt64LE(minTokensOut, 16);
  // track_volume = Some(true) = 1 (we include the volume accumulator accounts)
  data.writeUInt8(1, 24);

  const keys = [
    { pubkey: globalPda(), isSigner: false, isWritable: false }, // 0: global
    { pubkey: feeRecipient, isSigner: false, isWritable: true }, // 1: fee_recipient
    { pubkey: mint, isSigner: false, isWritable: false }, // 2: mint
    { pubkey: bondingCurve, isSigner: false, isWritable: true }, // 3: bonding_curve
    { pubkey: associatedBondingCurve, isSigner: false, isWritable: true }, // 4: associated_bonding_curve
    { pubkey: associatedUser, isSigner: false, isWritable: true }, // 5: associated_user
    { pubkey: user, isSigner: true, isWritable: true }, // 6: user (signer)
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false }, // 7: system_program
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // 8: token_program
    { pubkey: creatorVault, isSigner: false, isWritable: true }, // 9: creator_vault
    { pubkey: eventAuthority, isSigner: false, isWritable: false }, // 10: event_authority
    { pubkey: PUMP_PROGRAM_ID, isSigner: false, isWritable: false }, // 11: program
    { pubkey: globalVolumeAcc, isSigner: false, isWritable: false }, // 12: global_volume_accumulator
    { pubkey: userVolumeAcc, isSigner: false, isWritable: true }, // 13: user_volume_accumulator
    { pubkey: feeConfig, isSigner: false, isWritable: false }, // 14: fee_config
    { pubkey: PUMP_FEE_PROGRAM_ID, isSigner: false, isWritable: false }, // 15: fee_program
  ];

  return new TransactionInstruction({
    programId: PUMP_PROGRAM_ID,
    keys,
    data,
  });
}

/**
 * Create an Associated Token Account instruction (idempotent version —
 * safe even if the ATA already exists).
 */
function createAtaInstruction(user: PublicKey, mint: PublicKey): TransactionInstruction {
  const ata = getAssociatedTokenAddress(user, mint);
  // Idempotent create — doesn't fail if ATA already exists
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: user, isSigner: true, isWritable: true }, // payer
      { pubkey: ata, isSigner: false, isWritable: true }, // ata
      { pubkey: user, isSigner: false, isWritable: false }, // owner
      { pubkey: mint, isSigner: false, isWritable: false }, // mint
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1, 0, 0, 0]), // CreateIdempotent instruction discriminator
  });
}

export const Route = createFileRoute("/api/pumpfun/buy")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),

      POST: async ({ request }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return jsonError(400, "Invalid JSON");
        }

        const b = body as {
          mint?: unknown;
          userPublicKey?: unknown;
          amountLamports?: unknown;
          slippageBps?: unknown;
          priorityFeeLamports?: unknown;
        };

        // Validate inputs
        if (typeof b.mint !== "string" || typeof b.userPublicKey !== "string") {
          return jsonError(400, "mint and userPublicKey required");
        }
        const amountLamports = Number(b.amountLamports);
        if (!Number.isFinite(amountLamports) || amountLamports <= 0) {
          return jsonError(400, "amountLamports must be a positive number");
        }
        const slippageBps = Number(b.slippageBps ?? 300);
        if (!Number.isFinite(slippageBps) || slippageBps < 0 || slippageBps > 10000) {
          return jsonError(400, "slippageBps must be between 0 and 10000");
        }

        let user: PublicKey, mint: PublicKey;
        try {
          user = new PublicKey(b.userPublicKey);
          mint = new PublicKey(b.mint);
        } catch {
          return jsonError(400, "Invalid public key");
        }

        const solIn = BigInt(Math.floor(amountLamports));
        const priorityFeeLamports = b.priorityFeeLamports
          ? Math.floor(Number(b.priorityFeeLamports))
          : 50_000; // 0.00005 SOL default priority fee for sniping speed

        try {
          // 1. Fetch the bonding curve account
          const bcAddress = bondingCurvePda(mint);
          const bcData = await fetchAccountData(bcAddress);
          if (!bcData) {
            return jsonError(
              404,
              "Bonding curve account not found — token may have graduated or not exist",
            );
          }

          let bc: ReturnType<typeof decodeBondingCurve>;
          try {
            bc = decodeBondingCurve(bcData);
          } catch (e) {
            return jsonError(
              500,
              `Failed to decode bonding curve: ${e instanceof Error ? e.message : String(e)}`,
            );
          }

          if (bc.complete) {
            return jsonError(
              410,
              "Bonding curve is complete — token has graduated to AMM. Use Jupiter instead.",
            );
          }

          // 2. Fetch the Global account to get the fee_recipient
          const globalAddress = globalPda();
          const globalData = await fetchAccountData(globalAddress);
          if (!globalData) {
            return jsonError(500, "Global account not found — pump.fun program may be unavailable");
          }

          let global: ReturnType<typeof decodeGlobal>;
          try {
            global = decodeGlobal(globalData);
          } catch (e) {
            return jsonError(
              500,
              `Failed to decode global: ${e instanceof Error ? e.message : String(e)}`,
            );
          }

          // 3. Compute expected token output and slippage-adjusted minimum
          const expectedTokensOut = computeBuyTokensOut(
            solIn,
            bc.virtualTokenReserves,
            bc.virtualQuoteReserves,
          );
          if (expectedTokensOut <= 0n) {
            return jsonError(400, "Computed token output is zero — SOL amount too small");
          }
          const minTokensOut = applySlippage(expectedTokensOut, BigInt(slippageBps));

          // 4. Derive all account addresses
          const associatedBondingCurve = getAssociatedTokenAddress(bcAddress, mint);
          const associatedUser = getAssociatedTokenAddress(user, mint);

          // 5. Check if user needs an ATA created
          const needsAta = !(await userHasAta(user, mint));

          // 6. Build instructions
          const instructions: TransactionInstruction[] = [];

          // Priority fee (compute budget) — important for sniping speed
          instructions.push(
            ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFeeLamports }),
          );
          instructions.push(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }));

          // Create ATA if needed (idempotent — safe if it already exists)
          if (needsAta) {
            instructions.push(createAtaInstruction(user, mint));
          }

          // The buy instruction
          instructions.push(
            buildBuyExactSolInInstruction({
              user,
              mint,
              bondingCurve: bcAddress,
              associatedBondingCurve,
              associatedUser,
              feeRecipient: global.feeRecipient,
              creator: bc.creator,
              spendableSolIn: solIn,
              minTokensOut,
            }),
          );

          // 7. Fetch blockhash and build the VersionedTransaction
          const { blockhash } = await fetchRecentBlockhash();

          const message = new TransactionMessage({
            payerKey: user,
            recentBlockhash: blockhash,
            instructions,
          }).compileToV0Message();

          const tx = new VersionedTransaction(message);
          const serialized = Buffer.from(tx.serialize()).toString("base64");

          return new Response(
            JSON.stringify({
              swapTransaction: serialized,
              // Echo back the computed values for logging/display
              expectedTokensOut: expectedTokensOut.toString(),
              minTokensOut: minTokensOut.toString(),
              spendableSolIn: solIn.toString(),
              slippageBps,
              bondingCurveComplete: false,
            }),
            { status: 200, headers: { "Content-Type": "application/json", ...CORS } },
          );
        } catch (e) {
          const detail = e instanceof Error ? e.message : String(e);
          return new Response(JSON.stringify({ error: "pump.fun buy build failed", detail }), {
            status: 200,
            headers: { "Content-Type": "application/json", ...CORS },
          });
        }
      },
    },
  },
});

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}
