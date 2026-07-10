// Ported from SniperBot's src/market/poolDiscoveryFeed.js, adapted from a
// persistent logsSubscribe WebSocket to Helius "raw" webhook payloads (which
// carry the same meta.preTokenBalances/postTokenBalances/logMessages shape
// as a standard getTransaction RPC response). Serverless-safe: no long-lived
// connection required — Helius pushes us one HTTP POST per matching tx.

export const NATIVE_SOL_MINT = "So11111111111111111111111111111111111111112";
export const RAYDIUM_AMM_V4_PROGRAM_ID = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8";
export const RAYDIUM_CPMM_PROGRAM_ID = "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C";
export const PUMP_FUN_PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";

export const WATCHED_PROGRAM_IDS = [
  RAYDIUM_AMM_V4_PROGRAM_ID,
  RAYDIUM_CPMM_PROGRAM_ID,
  PUMP_FUN_PROGRAM_ID,
] as const;

const POOL_CREATION_LOG_MARKERS: Record<string, string[]> = {
  [RAYDIUM_AMM_V4_PROGRAM_ID]: ["initialize2", "Initialize2"],
  [RAYDIUM_CPMM_PROGRAM_ID]: ["Instruction: Initialize"],
  [PUMP_FUN_PROGRAM_ID]: ["Instruction: Create"],
};

const KNOWN_QUOTE_MINTS = new Set([
  NATIVE_SOL_MINT,
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
]);

// Account index of the LP mint within each program's pool-creation
// instruction, resolved from the actual on-chain instruction account
// layouts (not from any external API):
//   - Raydium AMM v4 `initialize2`: accounts[7]  (raydium-amm instruction.rs,
//     the `initialize2()` builder — index 7 is "AMM lp mint Account")
//   - Raydium CPMM `Initialize`: accounts[6] (raydium-cp-swap
//     instructions/initialize.rs, Anchor #[derive(Accounts)] field order —
//     6th field is `lp_mint`)
//   - Pump.fun `Create`: NOT APPLICABLE. Pre-migration, pump.fun tokens
//     trade against a bonding curve that holds SOL/tokens directly — there
//     is no separate fungible LP token to lock or burn. LP lock/burn only
//     becomes a meaningful check once (if) the token migrates to a real
//     Raydium pool, which is a distinct, later on-chain event.
const LP_MINT_ACCOUNT_INDEX: Record<string, number> = {
  [RAYDIUM_AMM_V4_PROGRAM_ID]: 7,
  [RAYDIUM_CPMM_PROGRAM_ID]: 6,
};

export function resolveLpMint(programId: string, accountKeys: string[]): string | null {
  const idx = LP_MINT_ACCOUNT_INDEX[programId];
  if (idx == null) return null; // pump.fun or unrecognized program
  return accountKeys[idx] ?? null;
}

export function venueForProgram(programId: string): string {
  if (programId === RAYDIUM_AMM_V4_PROGRAM_ID || programId === RAYDIUM_CPMM_PROGRAM_ID) {
    return "solana/raydium";
  }
  if (programId === PUMP_FUN_PROGRAM_ID) return "solana/pump.fun";
  return "solana/unknown";
}

export function matchesCreationLog(programId: string, logs: string[]): boolean {
  const markers = POOL_CREATION_LOG_MARKERS[programId];
  if (!markers) return false;
  return logs.some((line) => markers.some((marker) => line.includes(marker)));
}

interface TokenBalance {
  mint: string;
  uiTokenAmount?: { decimals?: number };
}

interface TxMeta {
  logMessages?: string[];
  preTokenBalances?: TokenBalance[];
  postTokenBalances?: TokenBalance[];
}

export interface NewMint {
  mint: string;
  decimals: number | null;
}

export function findNewMintsFromBalances(meta: TxMeta | undefined): NewMint[] {
  const preMints = new Set((meta?.preTokenBalances ?? []).map((b) => b.mint));
  const postBalances = meta?.postTokenBalances ?? [];
  const seen = new Map<string, NewMint>();
  for (const balance of postBalances) {
    if (!balance.mint || KNOWN_QUOTE_MINTS.has(balance.mint) || seen.has(balance.mint)) continue;
    if (preMints.has(balance.mint)) continue;
    seen.set(balance.mint, {
      mint: balance.mint,
      decimals: balance.uiTokenAmount?.decimals ?? null,
    });
  }
  return [...seen.values()];
}

/**
 * Extracts the set of program IDs actually invoked in a raw-webhook
 * transaction. Helius raw payloads resolve instruction programId either as
 * a direct string field or via a programIdIndex into accountKeys, depending
 * on API version — handle both rather than assuming one shape.
 */
export function extractInvokedProgramIds(tx: {
  transaction?: {
    message?: {
      instructions?: Array<{ programId?: string; programIdIndex?: number }>;
      accountKeys?: Array<string | { pubkey: string }>;
    };
  };
}): string[] {
  const message = tx.transaction?.message;
  if (!message?.instructions) return [];
  const accountKeys = (message.accountKeys ?? []).map((k) =>
    typeof k === "string" ? k : k.pubkey,
  );
  const ids = new Set<string>();
  for (const ix of message.instructions) {
    if (ix.programId) {
      ids.add(ix.programId);
    } else if (typeof ix.programIdIndex === "number" && accountKeys[ix.programIdIndex]) {
      ids.add(accountKeys[ix.programIdIndex]);
    }
  }
  return [...ids];
}

export interface DiscoveryCandidate {
  mint: string;
  decimals: number;
  venue: string;
  symbol: string;
  discoverySignature: string;
  // null = program has no separate LP mint concept (pump.fun bonding curve)
  // or resolution failed; distinct from an LP mint that turned out unlocked.
  lpMint: string | null;
}

/** Full pipeline: one raw-webhook transaction in, zero or more candidates out. */
export function extractCandidatesFromWebhookTx(tx: {
  signature?: string;
  meta?: TxMeta;
  transaction?: {
    message?: {
      instructions?: Array<{ programId?: string; programIdIndex?: number }>;
      accountKeys?: Array<string | { pubkey: string }>;
    };
    signatures?: string[];
  };
}): DiscoveryCandidate[] {
  if (!tx.meta) return [];
  const signature = tx.signature ?? tx.transaction?.signatures?.[0];
  if (!signature) return [];

  const logs = tx.meta.logMessages ?? [];
  const invokedPrograms = extractInvokedProgramIds(tx);
  const matchedProgram = invokedPrograms.find(
    (id) =>
      WATCHED_PROGRAM_IDS.includes(id as (typeof WATCHED_PROGRAM_IDS)[number]) &&
      matchesCreationLog(id, logs),
  );
  if (!matchedProgram) return [];

  const accountKeys = (tx.transaction?.message?.accountKeys ?? []).map((k) =>
    typeof k === "string" ? k : k.pubkey,
  );
  const lpMint = resolveLpMint(matchedProgram, accountKeys);

  const newMints = findNewMintsFromBalances(tx.meta);
  const venue = venueForProgram(matchedProgram);
  const out: DiscoveryCandidate[] = [];
  for (const { mint, decimals } of newMints) {
    if (decimals == null || decimals > 18) continue;
    const shortMint = `${mint.slice(0, 4)}..${mint.slice(-4)}`;
    out.push({
      mint,
      decimals,
      venue,
      symbol: shortMint,
      discoverySignature: signature,
      lpMint,
    });
  }
  return out;
}
