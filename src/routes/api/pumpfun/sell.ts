import { createFileRoute } from "@tanstack/react-router";
import {
  PublicKey,
  TransactionInstruction,
  VersionedTransaction,
  TransactionMessage,
  ComputeBudgetProgram,
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
  feeConfigPda,
  SELL_DISCRIMINATOR,
  decodeBondingCurve,
  decodeGlobal,
  computeSellSolOut,
  applySellSlippage,
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
 * account doesn't exist (same pattern as buy.ts).
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
 * Fetch the latest blockhash for transaction finalization.
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

/** Derive the Associated Token Account address for a (owner, mint) pair. */
function getAssociatedTokenAddress(owner: PublicKey, mint: PublicKey): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return ata;
}

/**
 * Fetch the user's token balance from their ATA. Used when the caller doesn't
 * supply an explicit token amount (full-exit sells). Returns the raw amount
 * in the mint's smallest denomination, or 0n if the ATA doesn't exist.
 *
 * SPL Token account layout (after 8-byte discriminator + 4-byte mint padding):
 *   offset 0:  mint          (pubkey, 32 bytes)
 *   offset 32: owner         (pubkey, 32 bytes)
 *   offset 64: amount        (u64)
 */
async function fetchTokenBalance(ata: PublicKey): Promise<bigint> {
  const data = await fetchAccountData(ata);
  if (!data || data.length < 8 + 64 + 8) return 0n;
  // Skip the 8-byte discriminator, then read the u64 amount at offset 64
  return data.readBigUInt64LE(8 + 64);
}

/**
 * Build the pump.fun `sell` instruction.
 *
 * Account layout (14 accounts, from the pump.fun IDL \u2014 `sell` instruction):
 *   [0]  global                    (readonly, PDA)
 *   [1]  fee_recipient             (writable)
 *   [2]  mint                      (readonly)
 *   [3]  bonding_curve             (writable, PDA)
 *   [4]  associated_bonding_curve  (writable, ATA of bonding_curve)
 *   [5]  associated_user           (writable, ATA of user)
 *   [6]  user                      (writable, signer)
 *   [7]  system_program            (readonly)
 *   [8]  creator_vault             (writable, PDA)
 *   [9]  token_program             (readonly)
 *   [10] event_authority           (readonly, PDA)
 *   [11] program                   (readonly, pump.fun program)
 *   [12] fee_config                (readonly, PDA from fee_program)
 *   [13] fee_program               (readonly)
 *
 * Args:
 *   amount:         u64 \u2014 exact tokens to sell (raw units)
 *   min_sol_output: u64 \u2014 minimum SOL to receive (lamports, slippage guard)
 */
function buildSellInstruction(params: {
  user: PublicKey;
  mint: PublicKey;
  bondingCurve: PublicKey;
  associatedBondingCurve: PublicKey;
  associatedUser: PublicKey;
  feeRecipient: PublicKey;
  creator: PublicKey;
  amount: bigint;
  minSolOutput: bigint;
}): TransactionInstruction {
  const {
    user,
    mint,
    bondingCurve,
    associatedBondingCurve,
    associatedUser,
    feeRecipient,
    creator,
    amount,
    minSolOutput,
  } = params;

  const creatorVault = creatorVaultPda(creator);
  const eventAuthority = eventAuthorityPda();
  const feeConfig = feeConfigPda();

  // Instruction data: discriminator(8) + amount(8) + min_sol_output(8)
  const data = Buffer.alloc(8 + 8 + 8);
  SELL_DISCRIMINATOR.copy(data, 0);
  data.writeBigUInt64LE(amount, 8);
  data.writeBigUInt64LE(minSolOutput, 16);

  const keys = [
    { pubkey: globalPda(), isSigner: false, isWritable: false }, // 0: global
    { pubkey: feeRecipient, isSigner: false, isWritable: true }, // 1: fee_recipient
    { pubkey: mint, isSigner: false, isWritable: false }, // 2: mint
    { pubkey: bondingCurve, isSigner: false, isWritable: true }, // 3: bonding_curve
    { pubkey: associatedBondingCurve, isSigner: false, isWritable: true }, // 4: associated_bonding_curve
    { pubkey: associatedUser, isSigner: false, isWritable: true }, // 5: associated_user
    { pubkey: user, isSigner: true, isWritable: true }, // 6: user (signer)
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false }, // 7: system_program
    { pubkey: creatorVault, isSigner: false, isWritable: true }, // 8: creator_vault
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // 9: token_program
    { pubkey: eventAuthority, isSigner: false, isWritable: false }, // 10: event_authority
    { pubkey: PUMP_PROGRAM_ID, isSigner: false, isWritable: false }, // 11: program
    { pubkey: feeConfig, isSigner: false, isWritable: false }, // 12: fee_config
    { pubkey: PUMP_FEE_PROGRAM_ID, isSigner: false, isWritable: false }, // 13: fee_program
  ];

  return new TransactionInstruction({
    programId: PUMP_PROGRAM_ID,
    keys,
    data,
  });
}

export const Route = createFileRoute("/api/pumpfun/sell")({
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
          slippageBps?: unknown;
          priorityFeeLamports?: unknown;
          // Optional: explicit token amount to sell (raw units as a string).
          // If omitted, the server fetches the user's full ATA balance
          // (full-exit sell).
          tokenAmountRaw?: unknown;
        };

        // Validate inputs
        if (typeof b.mint !== "string" || typeof b.userPublicKey !== "string") {
          return jsonError(400, "mint and userPublicKey required");
        }
        const slippageBps = Number(b.slippageBps ?? 500);
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

        const priorityFeeLamports = b.priorityFeeLamports
          ? Math.floor(Number(b.priorityFeeLamports))
          : 50_000; // 0.00005 SOL default priority fee

        try {
          // 1. Fetch the bonding curve account
          const bcAddress = bondingCurvePda(mint);
          const bcData = await fetchAccountData(bcAddress);
          if (!bcData) {
            return jsonError(
              404,
              "Bonding curve account not found \u2014 token may have graduated or not exist",
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
              "Bonding curve is complete \u2014 token has graduated to AMM. Use Jupiter instead.",
            );
          }

          // 2. Fetch the Global account to get the fee_recipient
          const globalAddress = globalPda();
          const globalData = await fetchAccountData(globalAddress);
          if (!globalData) {
            return jsonError(
              500,
              "Global account not found \u2014 pump.fun program may be unavailable",
            );
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

          // 3. Determine the token amount to sell.
          // If the caller supplied an explicit amount, use it (partial sell).
          // Otherwise fetch the user's full ATA balance (full-exit sell).
          let tokensToSell: bigint;
          if (typeof b.tokenAmountRaw === "string" && b.tokenAmountRaw.length > 0) {
            try {
              tokensToSell = BigInt(b.tokenAmountRaw);
            } catch {
              return jsonError(400, "tokenAmountRaw must be a valid u64 string");
            }
          } else {
            const userAta = getAssociatedTokenAddress(user, mint);
            tokensToSell = await fetchTokenBalance(userAta);
          }

          if (tokensToSell <= 0n) {
            return jsonError(
              400,
              "No tokens to sell \u2014 user ATA balance is zero or ATA missing",
            );
          }

          // 4. Compute expected SOL output (net of 1% fee) and slippage-adjusted minimum
          const expectedSolOut = computeSellSolOut(
            tokensToSell,
            bc.virtualTokenReserves,
            bc.virtualQuoteReserves,
          );
          if (expectedSolOut <= 0n) {
            return jsonError(400, "Computed SOL output is zero \u2014 token amount too small");
          }
          const minSolOutput = applySellSlippage(expectedSolOut, BigInt(slippageBps));

          // 5. Derive all account addresses
          const associatedBondingCurve = getAssociatedTokenAddress(bcAddress, mint);
          const associatedUser = getAssociatedTokenAddress(user, mint);

          // 6. Build instructions
          const instructions: TransactionInstruction[] = [];

          // Priority fee (compute budget) \u2014 for exit speed
          instructions.push(
            ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFeeLamports }),
          );
          instructions.push(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }));

          // The sell instruction
          // No ATA creation needed \u2014 the user already has one (they bought tokens)
          instructions.push(
            buildSellInstruction({
              user,
              mint,
              bondingCurve: bcAddress,
              associatedBondingCurve,
              associatedUser,
              feeRecipient: global.feeRecipient,
              creator: bc.creator,
              amount: tokensToSell,
              minSolOutput,
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
              tokensToSell: tokensToSell.toString(),
              expectedSolOut: expectedSolOut.toString(),
              minSolOutput: minSolOutput.toString(),
              slippageBps,
              bondingCurveComplete: false,
            }),
            { status: 200, headers: { "Content-Type": "application/json", ...CORS } },
          );
        } catch (e) {
          const detail = e instanceof Error ? e.message : String(e);
          return new Response(JSON.stringify({ error: "pump.fun sell build failed", detail }), {
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
