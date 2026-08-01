# Fix: Bot still not entering trades after PR #15

## Root Cause Analysis
- [x] Verify pump.fun buy endpoint works (tested: returns valid tx)
- [x] Verify rugcheck endpoint works (tested: score 75, verdict safe)
- [x] Verify Jupiter quote works for AMM tokens (tested: USDC)
- [x] Verify production is running latest code (sha f365491)
- [x] Discover liquidity=null issue for pump.fun DexScreener pairs
- [x] Confirm ALL pump.fun pairs return liquidity.usd=null, but have fdv/marketCap/priceUsd
- [x] Check pumpswap dexId (graduated pump.fun) vs pumpfun dexId (bonding curve)
- [x] Read checkLiveEntry, requestLiveEntry, applySafetyVerdict, pushRealOpportunity
- [x] Read use-auto-executor.ts, use-live-execution.ts

## Fixes Needed
- [ ] Fix 1: DexScreener stream — estimate liquidity for pump.fun tokens using fdv/marketCap
- [ ] Fix 2: pushRealOpportunity — don't reject pump.fun tokens with estimated liquidity
- [ ] Fix 3: applySafetyVerdict — don't gate pump.fun tokens on liquidity (use fdv as proxy)
- [ ] Fix 4: tick() discovery path — same liquidity estimation for pump.fun
- [ ] Fix 5: discovery.ts — same liquidity estimation for DexScreener fallback
- [ ] Fix 6: mapVenue — distinguish pumpfun (bonding curve) from pumpswap (graduated AMM)
- [ ] Fix 7: walletReady should check signTransaction
- [ ] Fix 8: run typecheck and fix errors
- [ ] Fix 9: run prettier formatting
- [ ] Fix 10: commit, push, create PR, merge
