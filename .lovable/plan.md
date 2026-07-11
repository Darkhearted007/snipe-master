# Production-Readiness Pass

Four workstreams, in order. Each ends with a Playwright verification against the live preview.

## 1. Debug pass — fix the current runtime error and any other errors

Reported: `TypeError: Cannot read properties of undefined (reading 'from')` inside `solana-provider-client` on `/auth`.

Root cause investigation targets (highest → lowest probability):

- `Buffer` is undefined at the point wallet-adapter code runs. `buffer-shim` is imported at the top of `__root.tsx`, but the client chunk containing `solana-provider-client` is dynamic-imported and can execute before the shim's side effect on a cold load. Fix: move the shim import to `src/router.tsx` (the true client entry) AND import it as the very first statement of `solana-provider-client.tsx` itself so the polyfill is guaranteed present in that chunk. Also assign `window.Buffer` and `window.global` explicitly.
- Empty `wallets` array + `WalletModalProvider` — some versions crash on `wallets[0].adapter.name` when the standard-wallet registry is empty. Add a defensive check and pass `wallets={[]}` explicitly typed.
- Verify with a Playwright script that loads `/auth`, captures `page.on("pageerror")` and console, then screenshots.

Do a full sweep after: run `bun run build:dev` (if the harness allows), open `/`, `/trades`, `/watchlist`, `/safety`, `/logs`, `/settings`, `/auth`, and record any remaining errors.

## 2. Real live trading via Jupiter (user wallet signs)

New server routes (keys stay server-side):

- `src/routes/api/jupiter/quote.ts` — proxies `GET https://quote-api.jup.ag/v6/quote` with `JUPITER_API_KEY`. Whitelists params; enforces slippage cap.
- `src/routes/api/jupiter/swap.ts` — proxies `POST https://quote-api.jup.ag/v6/swap`. Server injects the platform fee wallet as `feeAccount`/`referralAccount` so **Jupiter routes the platform fee on-chain automatically** (SOL is not eligible as fee mint on all routes → fallback: after swap confirms, browser sends a SOL transfer for `pnl * feePct` to `PLATFORM_FEE_WALLET`).
- `src/routes/api/jupiter/tokens.ts` — cached token list for symbol/mint resolution.

Client execution module `src/lib/jupiter.client.ts`:

- `getQuote(input, output, amountLamports, slippageBps)` → server route.
- `buildAndSign(quote, wallet)` → server returns base64 `swapTransaction`; browser deserializes `VersionedTransaction`, calls `wallet.signTransaction`, submits via `connection.sendRawTransaction`, then `connection.confirmTransaction`.
- On confirmed profitable exit in Live mode: build and sign a SOL transfer for the fee, submit, and log the tx sig into the decision log + `trade_history.fee_tx_sig`.

Wire the executor into `bot-store.closePosition` and TP/SL branches of `tick` so Live mode calls the real executor; Paper mode stays simulated. New `useLiveExecutor` hook exposes the browser-side signer to the store via a subscription.

Failure handling: any RPC / Jupiter error is logged as `error`, the position stays open, the bot keeps running (existing resilience rule).

## 3. Real DexScreener feed via WebSocket

DexScreener exposes the requested feeds over WSS with no auth. Browsers can connect directly (no CORS on WSS), so:

- New hook `src/hooks/use-dexscreener-stream.ts` opens one WebSocket per enabled feed, parses messages, applies existing safety filters, and pushes into `useBotStore.opportunities`.
- Reconnect with exponential backoff (1s → 30s cap). On `offline`, close cleanly and reopen on `online`.
- Existing REST poller in `use-dexscreener-feed.ts` becomes a fallback used only when WSS is disabled or fails 3 times in a row.
- Replace the current mock feed inside the simulator so Live mode consumes only WSS events (paper mode keeps synthetic ticks so demos still work without network).

## 4. Persist bot state per-user to Lovable Cloud

New tables (one migration, with GRANTs + RLS scoped to `auth.uid()`):

```text
trade_history         one row per closed trade
decision_logs         capped ring-buffer per user (server-side trim)
watchlist_entries     manual + auto entries
user_settings         JSONB: guardrails, safety_filters, platform_fee_pct, deposit
```

Server functions in `src/lib/persistence.functions.ts` (all `.middleware([requireSupabaseAuth])`):

- `loadUserState()` → hydrates the store on sign-in.
- `saveUserSettings(patch)` — debounced from the store on setting changes.
- `appendTradeHistory(entry)` — called from `closePosition`/TP/SL.
- `appendDecisionLogs(batch)` — batched every 3s, capped at 100 per batch.
- `saveWatchlist(entries)` — debounced 1s.

Store integration:

- Add `hydrateFromServer()` action, invoked in `AuthGate` after session is confirmed.
- Add `useServerPersistence()` hook subscribed to store slices with throttling/debouncing.
- `localStorage` persist stays as offline cache; server is source of truth on load.

## Technical notes

- Buffer shim must run before any `@solana/*` code in every client chunk. Import it at the top of both `src/router.tsx` and `src/lib/solana-provider-client.tsx`.
- Jupiter v6 swap responses may include a `blockhash` — use `connection.getLatestBlockhash` fallback and `sendRawTransaction({ skipPreflight: false, maxRetries: 2 })`.
- `VersionedTransaction` requires the `@solana/web3.js` deserializer; already in deps.
- All new server routes: standard CORS block + OPTIONS handler + Zod validation.
- Persistence writes are best-effort: a Cloud failure logs an `error` entry but never blocks the trading loop.
- No changes to auth flow, RLS pattern, or role gating.

## Verification checklist (Playwright, headless)

1. `/auth` loads with zero `pageerror`; wallet modal opens.
2. Signed-in home page loads all 6 routes without console errors.
3. Live-mode toggle → dialog → enable → Start button becomes enabled once a wallet is connected.
4. Force a WSS message via a devtools stub; opportunity appears in feed.
5. Trigger `closePosition` in Paper mode; row appears in `/trades` and DB `trade_history`.
6. Reload page while signed in; watchlist + settings restore from server.
