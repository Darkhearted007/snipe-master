## SniperBot Control Dashboard

A single-page operator dashboard to run the SniperBot in **Paper** mode (default, 0.1 SOL simulated bankroll) or **Solana Live** mode (opt-in, guarded), with clear start/stop controls and real-time status indicators.

This plan covers **frontend UI only** — mocked state and simulated data. No wallet connect, RPC calls, or actual trading logic. Wiring to a real backend can come in a follow-up.

### Layout

```text
┌───────────────────────────────────────────────────────────────┐
│ Sidebar │  Header: Mode toggle (Paper | Live)  •  Kill switch │
│         ├───────────────────────────────────────────────────── │
│ Overview│  Status strip: ● Running  Uptime  P&L  Open  Skips  │
│ Trades  ├──────────────────────┬────────────────────────────── │
│ Watchlist│ Bankroll / Equity   │  Guardrails                    │
│ Safety  │  chart + KPIs       │  drawdown, daily loss, size   │
│ Logs    ├──────────────────────┴────────────────────────────── │
│ Settings│  Opportunity feed (live table)                       │
│         │  token • venue • liquidity • safety • confidence     │
│         ├────────────────────────────────────────────────────── │
│         │  Open positions           │  Recent decisions log    │
└─────────┴───────────────────────────┴────────────────────────── ┘
```

### Sections

1. **Header bar**
   - App logo + name "SniperBot".
   - Mode segmented control: **Paper** / **Solana Live**. Switching to Live opens a confirmation dialog explaining risk and requiring an explicit "I understand" toggle before enabling.
   - Big **Start / Stop** button (state-driven: green Start when idle, red Stop when running).
   - **Kill switch** icon button (immediately halts + closes simulated positions).

2. **Status strip** (sticky under header)
   - Run status dot: Idle / Running / Paused / Error with animated pulse when running.
   - Uptime timer, current mode badge, active venues (Raydium, Pump.fun, BSC).
   - KPIs: Bankroll (SOL), Session P&L, Open positions, Trades today, Skips today.

3. **Equity & bankroll card**
   - Sparkline of bankroll over the session (mocked).
   - Starting bankroll (0.1 SOL for paper), current, peak, drawdown %.

4. **Guardrails card**
   - Progress bars for: Max position size, Daily loss limit, Drawdown limit, Duplicate-position guard.
   - Each with current vs. configured cap; turns amber near threshold, red at breach (which auto-pauses the bot in UI).

5. **Opportunity feed table**
   - Streaming rows (mock ticker) of newly discovered pairs.
   - Columns: token, venue chip, liquidity, safety score, strategy confidence, decision (Enter / Skip with reason).
   - Row click → side drawer with full safety checks + strategy rationale.

6. **Open positions table**
   - Token, entry, current, unrealized P&L, dynamic TP/SL, age, manual close button.

7. **Recent decisions log**
   - Compact timeline: timestamp, event type (feed / safety / strategy / execution / learning), one-line summary. Filter chips per type.

8. **Sidebar routes** (each its own TanStack route file)
   - `/` Overview (everything above)
   - `/trades` full trade history + filters
   - `/watchlist` curated Solana universe (Live mode) with add/remove and auto-select toggle
   - `/safety` per-token safety screening detail
   - `/logs` full decision/execution log with search
   - `/settings` risk config (caps, limits), venue toggles, auth mode (wallet session vs. secret key — UI only)

### Behavior (UI-level, mocked)

- Start → status flips to Running, uptime ticks, opportunity feed streams mock rows every 1–3s, occasional simulated entries/exits update bankroll and positions.
- Stop → status flips to Idle, streams pause, open positions remain until manually closed or killed.
- Kill switch → confirm dialog → force stop + clear open positions with a "flattened" toast.
- Live-mode gate → cannot Start in Live mode until user confirms risk dialog and a mock "wallet connected" state exists (button in header; purely visual for now).
- Guardrail breach → toast + auto-pause; Start button disabled until user acknowledges in Settings.

### Design direction

- Dark, dense operator/terminal aesthetic (fits a trading bot). Semantic tokens defined in `src/styles.css`:
  - Background near-black, elevated cards one step lighter.
  - Accent: electric green for Running / profit, red for Stop / loss, amber for warnings, cyan for Live-mode chrome.
  - Mono font (JetBrains Mono via `@fontsource/jetbrains-mono`) for numbers/tickers; Inter for UI text.
- Subtle pulse on the Running status dot, row-enter animation on the opportunity feed, count-up on KPIs.
- Uses shadcn primitives already in the project (Card, Table, Badge, Progress, Dialog, Tabs, Sonner toasts, Sidebar).

### Technical notes

- New route files:
  - `src/routes/index.tsx` (replace placeholder with Overview)
  - `src/routes/trades.tsx`, `watchlist.tsx`, `safety.tsx`, `logs.tsx`, `settings.tsx`
- Layout via existing shadcn `Sidebar` in `src/routes/__root.tsx` (kept collapsible with visible trigger in header).
- Mock state in a single `src/lib/bot-store.ts` (Zustand or plain React context + reducer) with a `useBotSimulator` hook that drives the streaming updates via `setInterval` while status is `running`. Cleanly stoppable, all client-side.
- Types in `src/lib/bot-types.ts` mirroring the repo's domain (Opportunity, SafetyReport, Decision, Position, Guardrails, ModeConfig).
- Update `__root.tsx` head with real title/description: "SniperBot — Control Dashboard".
- No backend, no Cloud, no secrets in this pass.

Approve to build, or tell me what to change (scope, sections, style).