## Scope (Phase 1 — nothing yet signs real transactions)

Goal: replace the mocked wallet + client-only state with production-grade primitives, so Phase 2 (Jupiter dry-run) and Phase 3 (real execution + platform fees + supervisor) can land safely.

### 1. Solana Wallet Adapter (multi-wallet, non-custodial)
- Install `@solana/wallet-adapter-react`, `@solana/wallet-adapter-react-ui`, `@solana/wallet-adapter-wallets`, `@solana/web3.js`.
- Wrap the app in `ConnectionProvider` (Helius RPC — proxied via server fn, never exposing the key) + `WalletProvider` with Phantom, Solflare, Backpack, Ledger, Trust, Coin98, WalletConnect (Torus optional).
- Replace mocked `walletConnected` state in `bot-store.ts` with adapter-driven state. Sync `publicKey.toBase58()` to the store on connect/disconnect. `autoConnect` = true so the session persists across reloads.
- Replace `ControlHeader` connect button with `WalletMultiButton` styled to match, or a custom trigger opening the adapter modal (multiple wallets, not just Phantom).

### 2. Fix "paper ↔ live toggle not responding"
- Root cause candidates I'll verify: (a) `handleMode('live')` early-returns when `liveConfirmed` is already true but `walletConnected` is false, so the button visually looks stuck; (b) `canStart` gate silently blocks Start; (c) mode change doesn't rerun the simulator effect.
- Fix: separate "enable live" from "switch to live" — toggling to Live is always allowed; the *start* button is what enforces wallet + acknowledgement, with an inline explanatory badge instead of a silent no-op. Add explicit toast when a click is blocked.
- Simulator hook: gate on `mode === 'paper'` — Phase 3 will branch to real execution for live.

### 3. DexScreener live feed (real data, not simulated)
- Those URLs (`api.dexscreener.com/token-profiles/...`) are **HTTPS REST**, not WebSocket. `wss://` will fail. I'll build a **poller** in a server route (`/api/dexscreener/latest`, `/token-boosts/top`, etc.) that:
  - Fetches every 15–30s server-side (respecting DexScreener's ~60 req/min guidance),
  - Caches in memory with a short TTL,
  - Returns to the client with CORS headers.
- Client subscribes via a `useQuery` with `refetchInterval` and `refetchIntervalInBackground` (survives tab blur). Zustand still holds the derived opportunity feed.
- Filter incoming tokens through existing `safetyFilters` before they enter the watchlist.

### 4. Persist to Cloud (survives device switch + reloads)
- New tables (with RLS scoped to `auth.uid()`, GRANTs included):
  - `profiles(user_id, wallet_address, bankroll_sol, platform_fee_bps, adaptive_sizing, updated_at)`
  - `trade_history(id, user_id, mode, token, venue, size_sol, entry, exit, pnl_sol, fee_paid_sol, net_to_user_sol, reason, ts, tx_signature nullable)`
  - `audit_log(id, user_id, type, summary, meta jsonb, ts)`
  - `watchlist(id, user_id, symbol, mint, venue, source, enabled, safety, liquidity_sol, positive_streak, added_at, note)`
- Sign-in: email/password + Google (Lovable Cloud managed).
- Server fns (with `requireSupabaseAuth`): `getProfile`, `upsertProfile`, `listTrades`, `insertTrade`, `listAudit`, `appendAudit`, `syncWatchlist`.
- Zustand persistence stays as a local cache; a small `useSyncBotState` hook does write-through to server fns.

### 5. Resilience baseline (foundation for Phase 3 supervisor)
- Central `resilientFetch(url, opts, {retries, backoffMs})` with exponential backoff + jitter for all outbound calls (DexScreener, Helius, Jupiter).
- Simulator watchdog upgraded: instead of resetting to `idle` on error, it flips to a `degraded` badge and keeps the last known good state; only the Stop button transitions to `idle`.
- Network offline listener → pauses new opportunities but does NOT stop the bot; on `online` event, resumes.

### 6. Auth surface
- `/auth` public route with email/password + Google sign-in via `lovable.auth.signInWithOAuth`.
- Dashboard moves under `_authenticated/` layout so trade history and wallet are user-scoped.

### Explicit non-goals for Phase 1
- No Jupiter quote/swap calls yet.
- No on-chain transactions signed.
- No platform-fee routing yet (schema field is there, always 0).
- `PLATFORM_FEE_WALLET` secret is stored but only surfaced as read-only info in Settings.

### Technical notes
- `@solana/web3.js` and wallet adapter packages are browser-safe (no `child_process` etc.), so SSR is fine as long as `Connection` is created client-side or inside a server fn.
- Helius RPC key stays server-side; browser calls go through `/api/rpc` proxy or through server functions.
- Jupiter/DexScreener keys likewise proxied.

### Deliverables at end of Phase 1
- Multi-wallet connect works with real Phantom/Solflare/Backpack.
- Paper↔Live toggle is responsive with clear feedback.
- Real DexScreener data flows into the opportunity feed.
- Trade history + audit log persist across devices for a signed-in user.
- Bot no longer resets on transient failures — only Stop halts it.

Approve to proceed with Phase 1, or tell me what to change.