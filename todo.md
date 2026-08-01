# Opportunity Feed Automation Investigation & Fix

## Investigation
- [x] Examine bot-store.ts `tick()` function — how opportunities are processed, what decides SKIP vs BUY
- [x] Examine onchain-safety.ts — why safety scores are -1
- [x] Examine the UI Start button and bot lifecycle (idle/running states)
- [x] Examine the opportunity feed rendering and how decisions are shown
- [x] Examine discovery.ts endpoint — what data the feed actually receives

## Analysis — ROOT CAUSES IDENTIFIED
Three independent bugs cause the "all SKIP, safety=-1, bot idle" state:

**BUG 1 — `applySafetyVerdict` never updates `decision`/`safety`/`confidence`**
The DexScreener stream pushes opportunities with safety=-1, decision="skip",
then calls `/api/rugcheck/$mint` and invokes `applySafetyVerdict`. But that
function ONLY writes `safetyScore` and `verdict` — it NEVER updates `safety`
(the field the feed renders), `confidence`, or `decision`. So even after a
real safety check returns score=85, the opportunity still shows safety=-1
and decision="skip" forever. The tick() `checkLiveEntry` path reads
`opportunity.safetyScore ?? opportunity.score ?? opportunity.safety` so the
gate WOULD pass, but the FEED still shows SKIP because `decision` is never
flipped. And there is no auto-execute wiring to act on a passing gate.

**BUG 2 — `tick()` live-mode safety comes from `c.safety_score ?? -1`**
When Supabase is used and candidates have safety_score, tick() works. But
when falling back to DexScreener (the common case — Supabase env misconfigured
on Vercel), ALL candidates have `safety_score: null` → safety=-1 →
"safety not yet scored" → SKIP. The DexScreener fallback candidates are never
safety-evaluated because the eval loop in discovery.ts only processes rows
already in the Supabase table.

**BUG 3 — No auto-execute path in live mode**
In paper mode, tick() auto-enters on decision="enter" (simulated). In live
mode, tick() creates the opportunity with decision="enter" but does NOTHING
— it requires the user to manually click the Execute button per opportunity.
There is no `autoExecute` setting and no code path that calls
`requestLiveEntry` + `executeSwap` automatically. The feed is a manual
approval queue in live mode by design.

## Fix Plan
1. Fix `applySafetyVerdict` to update `safety`, `confidence`, and re-evaluate
   `decision` so the feed reflects real safety scores (fixes BUG 1)
2. Add safety evaluation to DexScreener fallback candidates in discovery.ts
   so they get real scores instead of null (fixes BUG 2)
3. Add an `autoExecute` safety-filter toggle + an auto-execute engine that
   fires on decision="enter" opportunities in live mode, calling the same
   requestLiveEntry → executeSwap → confirmLiveEntry path the manual button
   uses (fixes BUG 3)

## Fix
- [x] Implement the fix(es) on a feature branch (`fix/opportunity-feed-automation`)
- [x] Verify typecheck, lint, build pass (tsc ✓, eslint 0 errors ✓, vite build ✓, prettier 3.8.3 ✓)
- [x] Push branch and create PR (#9: https://github.com/Darkhearted007/snipe-master/pull/9)
- [x] All CI passing: Typecheck/lint/build ✓, both Vercel deployments ✓, MERGEABLE/CLEAN
