// Browser-only Jupiter swap executor. User's wallet signs every transaction.
// Never call this from SSR — it uses @solana/web3.js and the wallet adapter.
import type { Adapter } from "@solana/wallet-adapter-base";
import type { PublicKey } from "@solana/web3.js";

export const SOL_MINT = "So11111111111111111111111111111111111111112";

export interface JupiterQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: unknown[];
}

export async function getQuote(input: {
  inputMint: string;
  outputMint: string;
  amountLamports: string;
  slippageBps?: number;
}): Promise<JupiterQuote> {
  const params = new URLSearchParams({
    inputMint: input.inputMint,
    outputMint: input.outputMint,
    amount: input.amountLamports,
    slippageBps: String(input.slippageBps ?? 100),
  });
  const res = await fetch(`/api/jupiter/quote?${params.toString()}`);
  const data = (await res.json()) as JupiterQuote | { error: string };
  if (!res.ok || "error" in data) {
    throw new Error(("error" in data && data.error) || `Quote failed (${res.status})`);
  }
  return data;
}

export async function buildSwap(input: {
  quote: JupiterQuote;
  userPublicKey: string;
}): Promise<{ swapTransaction: string; lastValidBlockHeight?: number }> {
  const res = await fetch(`/api/jupiter/swap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse: input.quote,
      userPublicKey: input.userPublicKey,
    }),
  });
  const data = (await res.json()) as
    | { swapTransaction: string; lastValidBlockHeight?: number }
    | { error: string };
  if (!res.ok || "error" in data) {
    throw new Error(("error" in data && data.error) || `Swap build failed (${res.status})`);
  }
  return data;
}

/** Execute a Jupiter swap: quote → build → sign in wallet → send + confirm. */
export async function executeSwap(input: {
  connection: import("@solana/web3.js").Connection;
  wallet: Adapter;
  inputMint: string;
  outputMint: string;
  amountLamports: string;
  slippageBps?: number;
}): Promise<{ signature: string; quote: JupiterQuote }> {
  const web3 = await import("@solana/web3.js");
  if (!input.wallet.publicKey) throw new Error("Wallet not connected");
  if (!("signTransaction" in input.wallet) || !input.wallet.signTransaction) {
    throw new Error("Wallet does not support signTransaction");
  }
  const quote = await getQuote({
    inputMint: input.inputMint,
    outputMint: input.outputMint,
    amountLamports: input.amountLamports,
    slippageBps: input.slippageBps,
  });
  const built = await buildSwap({
    quote,
    userPublicKey: input.wallet.publicKey.toBase58(),
  });
  const raw = Buffer.from(built.swapTransaction, "base64");
  const tx = web3.VersionedTransaction.deserialize(raw);
  const signed = await (
    input.wallet as unknown as {
      signTransaction: (
        t: import("@solana/web3.js").VersionedTransaction,
      ) => Promise<import("@solana/web3.js").VersionedTransaction>;
    }
  ).signTransaction(tx);
  const sig = await input.connection.sendRawTransaction(signed.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });
  const latest = await input.connection.getLatestBlockhash();
  await input.connection.confirmTransaction({ signature: sig, ...latest }, "confirmed");
  return { signature: sig, quote };
}

/** Send a native SOL transfer (used for platform fee routing on profits). */
export async function sendSolTransfer(input: {
  connection: import("@solana/web3.js").Connection;
  wallet: Adapter;
  toAddress: string;
  lamports: number;
}): Promise<string> {
  const web3 = await import("@solana/web3.js");
  if (!input.wallet.publicKey) throw new Error("Wallet not connected");
  if (!("signTransaction" in input.wallet) || !input.wallet.signTransaction) {
    throw new Error("Wallet does not support signTransaction");
  }
  const from = input.wallet.publicKey as PublicKey;
  const to = new web3.PublicKey(input.toAddress);
  const latest = await input.connection.getLatestBlockhash();
  const msg = new web3.TransactionMessage({
    payerKey: from,
    recentBlockhash: latest.blockhash,
    instructions: [
      web3.SystemProgram.transfer({
        fromPubkey: from,
        toPubkey: to,
        lamports: Math.max(0, Math.floor(input.lamports)),
      }),
    ],
  }).compileToV0Message();
  const tx = new web3.VersionedTransaction(msg);
  const signed = await (
    input.wallet as unknown as {
      signTransaction: (
        t: import("@solana/web3.js").VersionedTransaction,
      ) => Promise<import("@solana/web3.js").VersionedTransaction>;
    }
  ).signTransaction(tx);
  const sig = await input.connection.sendRawTransaction(signed.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });
  await input.connection.confirmTransaction({ signature: sig, ...latest }, "confirmed");
  return sig;
}
