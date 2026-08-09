# Auto-Entry Fix & Profitability Audit

## Root Cause Analysis — COMPLETED
- [x] Read auto-entry chain (useAutoExecutor → checkLiveEntry → executeSwap → confirmLiveEntry)
- [x] Read discovery chain (DexScreener → pushRealOpportunity → fetchSafetyVerdict → applySafetyVerdict)
- [x] Read safety scoring (rugcheck endpoint + onchain-safety.ts)
- [x] Read useWalletReady + use-wallet-sync.ts — wallet sync works (via WalletBar mount)
- [x] Read useAutoExecutor full file — armed condition correct, but has a critical subscriber bug
- [x] Read applySafetyVerdict confidence recalculation — logic correct
- [x] Check liveConfirmed flow — set by confirmLive() on dialog accept
- [x] Read tick() — no early return for live mode (only checks status + guardrail). The line 480 "early return" is in start(), not tick() — that's correct.

## IDENTIFIED ROOT CAUSES

### CRITICAL BUG 1: useAutoExecutor subscriber never fires on decision changes
The `useBotStore.subscribe()` callback receives the FULL state on every store update.
It filters for `decision === "enter"` opportunities. BUT: the subscriber fires on
ANY state change, and `applySafetyVerdict` does a `set()` that updates the opportunity.
The subscriber SHOULD catch this. However, the `processedRef` check may prematurely
mark opportunities. Need to verify the subscribe mechanism works with Zustand's
default subscribe (which fires on every set, not just specific slices).

Actually — Zustand's `subscribe` fires on every state change, so when
`applySafetyVerdict` flips decision to "enter", the subscriber fires and catches it.
This path WORKS.

### CRITICAL BUG 2: autoExecute defaults to false
`autoExecute: false` by default. The user must go to the Watchlist page and toggle
"Auto-Execute" on. If they don't, the `armed` condition in useAutoExecutor is never
true, and no auto-entries happen. This is the #1 cause: the user likely hasn't
toggled autoExecute on.

### CRITICAL BUG 3: Duplicate guard blocks re-entry across feed cycles
In `applySafetyVerdict`: `if (s.guardrails.duplicateGuard && s.positions.some((p) => p.token === opp.token))` — this checks by TOKEN SYMBOL, not mint. DexScreener
returns the same trending tokens repeatedly (SOL pairs). Once a position is open
for a token symbol, ALL future opportunities with the same symbol get "duplicate
position" → "skip". Worse, even after the position closes, if a new opportunity
with the same symbol appears, it's still blocked because the check only looks at
open positions — that's actually fine. But the real issue: trending tokens repeat,
so the feed floods with duplicate symbols that all get blocked.

### CRITICAL BUG 4: Dead config — requireLpLocked, blockHoneypots, maxHolderConcentrationPct
These are defined in SafetyFilters but NEVER checked in applySafetyVerdict or
checkLiveEntry. The rugcheck endpoint computes lpLocked, topHolderPct, etc. but
the decision logic ignores them. This means:
- `requireLpLocked: true` does nothing — tokens with unlocked LP pass through
- `blockHoneypots: true` does nothing — the on-chain honeypot probe IS checked
  in the rugcheck endpoint (hard fail on honeypotSellable === false), but the
  SafetyFilters.blockHoneypots flag is never consulted
- `maxHolderConcentrationPct: 25` does nothing — concentrated tokens pass through

### PROFITABILITY ISSUE 1: maxPositionSol = 0.02 SOL is extremely small
With `maxPositionSol: 0.02` and `adaptiveSizing: false`, every position is
capped at 0.02 SOL (~$3). The position size formula is:
`minSize = Math.max(0.001, Math.min(bankroll * 0.1, maxPositionSol))`
So with bankroll = 0.1 SOL, minSize = min(0.01, 0.02) = 0.01 SOL.
The TP is 12% and SL is 6%, so max profit per trade = 0.01 * 0.12 = 0.0012 SOL.
After Solana tx fees (~0.000005 SOL × 2 for buy+sell) and Jupiter/pump.fun
fees, the net profit per winning trade is negligible. The bot can be "profitable"
but the absolute returns are tiny. This isn't a bug but a UX issue — the user
should increase maxPositionSol for meaningful returns.

### PROFITABILITY ISSUE 2: TP/SL ratio is 12%/6% = 2:1 reward:risk
This is fine for profitability IF the win rate is > ~33%. The 2:1 ratio means
the bot needs to win 1 in 3 trades to break even (before fees). This is reasonable.

### PROFITABILITY ISSUE 3: Price feed entry reference may be stale
The live price feed records the FIRST observed USD price as "entry reference"
and computes current = entry * (priceNow / priceAtEntry). But `entry` is set
to `opp.entryPrice ?? opp.price ?? 1` in confirmLiveEntry — and the opportunity
rarely has an entryPrice set (it's not populated by pushRealOpportunity or
applySafetyVerdict). So entry defaults to 1.0, and the price feed's ratio
computation uses the DexScreener USD price ratio, which is correct relative to
the first observation. BUT: the entry price of 1.0 means the TP = 1.12 and
SL = 0.94. The current price only moves when DexScreener updates. If the token
price doesn't move enough in USD terms, TP/SL never trigger. This is OK —
it means exits only fire on real price movement.

Actually there IS a subtle issue: `entry` is always 1.0 (since no entryPrice is
set), so `current` starts at 1.0 and the price feed sets it to
`1.0 * (priceNow / priceAtEntry)`. The priceAtEntry is the FIRST price the feed
sees AFTER the position is opened — not the actual entry fill price. So there's
a timing gap: the position opens at time T, the feed first polls at T+10s, and
the "entry reference" is the price at T+10s, not T. If the price moved between
T and T+10s, the P&L is measured from T+10s, not from the actual entry. This
could cause the bot to miss the TP/SL window or trigger it late.

## Fixes to implement
- [ ] Fix 1: Wire up dead safety config (requireLpLocked, blockHoneypots, maxHolderConcentrationPct) into applySafetyVerdict
- [ ] Fix 2: Add duplicate guard by MINT (not just token symbol) in applySafetyVerdict
- [ ] Fix 3: Set entryPrice on opportunities from DexScreener priceUsd so live positions track real entry
- [ ] Fix 4: Make autoExecute more discoverable — show a prominent warning/banner when in live mode without autoExecute
- [ ] Fix 5: Increase default maxPositionSol to a more meaningful value (0.05 SOL)
- [ ] Fix 6: Add entryPrice to pushRealOpportunity from DexScreener stream
- [ ] Fix 7: Run typecheck + prettier
- [ ] Fix 8: Create PR + merge
