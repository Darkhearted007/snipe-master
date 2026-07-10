// Real swap execution against Jupiter's public aggregator API.
// No API key required for quote/swap. This replaces the Math.random()
// price-drift simulator for LIVE mode only — PAPER mode keeps simulating.
//
// Flow: getQuote() -> buildSwapTransaction() -> wallet signs (browser popup)
// -> caller submits via connection.sendRawTransaction() and polls confirmation.
// The private key never touches this module or the server; signing happens
// entirely in the user's wallet extension.

const JUP_QUOTE_URL = "https://lite-api.jup.ag/swap/v1/quote";
const JUP_SWAP_URL = "https://lite-api.jup.ag/swap/v1/swap";
export const SOL_MINT = "So11111111111111111111111111111111111111112";

export interface JupiterQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  priceImpactPct: string;
  slippageBps: number;
  routePlan: unknown[];
  raw: unknown;
}

export class JupiterError extends Error {
  constructor(
    message: string,
    public readonly stage: "quote" | "swap" | "send" | "confirm",
  ) {
    super(message);
    this.name = "JupiterError";
  }
}

/**
 * Get a live quote. amountLamports must be an integer string/number in the
 * input token's smallest unit (lamports for SOL).
 */
export async function getQuote(params: {
  inputMint: string;
  outputMint: string;
  amountLamports: number;
  slippageBps: number;
}): Promise<JupiterQuote> {
  const { inputMint, outputMint, amountLamports, slippageBps } = params;
  if (!Number.isFinite(amountLamports) || amountLamports <= 0) {
    throw new JupiterError("Invalid trade amount", "quote");
  }
  const url = new URL(JUP_QUOTE_URL);
  url.searchParams.set("inputMint", inputMint);
  url.searchParams.set("outputMint", outputMint);
  url.searchParams.set("amount", String(Math.floor(amountLamports)));
  url.searchParams.set("slippageBps", String(slippageBps));
  // restrictIntermediateTokens reduces exposure to illiquid multi-hop routes.
  url.searchParams.set("restrictIntermediateTokens", "true");

  const res = await fetch(url.toString(), { headers: { accept: "application/json" } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new JupiterError(`Quote failed (${res.status}): ${body.slice(0, 200)}`, "quote");
  }
  const raw = await res.json();
  if (!raw || typeof raw !== "object" || !("outAmount" in raw)) {
    throw new JupiterError("Quote response missing outAmount — no route found", "quote");
  }
  const r = raw as Record<string, unknown>;
  return {
    inputMint,
    outputMint,
    inAmount: String(r.inAmount),
    outAmount: String(r.outAmount),
    otherAmountThreshold: String(r.otherAmountThreshold),
    priceImpactPct: String(r.priceImpactPct ?? "0"),
    slippageBps,
    routePlan: (r.routePlan as unknown[]) ?? [],
    raw,
  };
}

/**
 * Build an unsigned swap transaction for the given quote. Returns a
 * base64-encoded VersionedTransaction ready for the wallet to sign.
 * priorityFeeLamports lets you set a compute-unit price so the tx doesn't
 * get stuck behind faster snipers during volatile launches.
 */
export async function buildSwapTransaction(params: {
  quote: JupiterQuote;
  userPublicKey: string;
  priorityFeeLamports?: number;
}): Promise<string> {
  const { quote, userPublicKey, priorityFeeLamports } = params;
  const res = await fetch(JUP_SWAP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote.raw,
      userPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: priorityFeeLamports
        ? {
            priorityLevelWithMaxLamports: {
              maxLamports: priorityFeeLamports,
              priorityLevel: "high",
            },
          }
        : "auto",
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new JupiterError(`Swap build failed (${res.status}): ${body.slice(0, 200)}`, "swap");
  }
  const data = (await res.json()) as { swapTransaction?: string; error?: string };
  if (!data.swapTransaction) {
    throw new JupiterError(data.error ?? "No swapTransaction returned", "swap");
  }
  return data.swapTransaction;
}

/** Sanity guard: refuse quotes with runaway price impact regardless of what the UI slippage setting says. */
export function assertSafePriceImpact(quote: JupiterQuote, maxPct: number): void {
  const impact = Number.parseFloat(quote.priceImpactPct);
  if (Number.isFinite(impact) && impact > maxPct) {
    throw new JupiterError(
      `Price impact ${impact.toFixed(2)}% exceeds max allowed ${maxPct}%`,
      "quote",
    );
  }
}
