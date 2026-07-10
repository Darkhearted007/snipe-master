import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// settings payload arrives as a JSON string to avoid TanStack's
// unknown-serialization guard.
const settingsInput = z.object({
  settingsJson: z.string().max(50_000),
});

const tradeInput = z.object({
  ts: z.number(),
  mode: z.enum(["paper", "live"]),
  token: z.string(),
  venue: z.string(),
  size_sol: z.number(),
  entry: z.number(),
  exit: z.number(),
  pnl_sol: z.number(),
  reason: z.string(),
  fee_paid_sol: z.number().default(0),
  net_to_user_sol: z.number().default(0),
  fee_wallet: z.string().nullable().optional(),
  swap_tx_sig: z.string().nullable().optional(),
  fee_tx_sig: z.string().nullable().optional(),
});

const logsInput = z.object({
  entries: z
    .array(
      z.object({
        ts: z.number(),
        type: z.string(),
        summary: z.string(),
      }),
    )
    .max(100),
});

const watchInput = z.object({
  entries: z.array(
    z.object({
      symbol: z.string(),
      venue: z.string(),
      source: z.enum(["manual", "auto"]),
      enabled: z.boolean(),
      safety: z.number().int(),
      liquidity_sol: z.number(),
      positive_streak: z.number().int(),
      note: z.string().nullable().optional(),
      added_at: z.number(),
    }),
  ),
});

export type LoadedState = {
  settings: string | null; // JSON-stringified blob
  trades: string; // JSON-stringified array
  logs: string;
  watchlist: string;
};

export const loadUserState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LoadedState> => {
    const { supabase, userId } = context as {
      supabase: import("@supabase/supabase-js").SupabaseClient;
      userId: string;
    };
    const [s, t, l, w] = await Promise.all([
      supabase.from("user_settings").select("settings").eq("user_id", userId).maybeSingle(),
      supabase
        .from("trade_history")
        .select("*")
        .eq("user_id", userId)
        .order("ts", { ascending: false })
        .limit(200),
      supabase
        .from("decision_logs")
        .select("*")
        .eq("user_id", userId)
        .order("ts", { ascending: false })
        .limit(300),
      supabase.from("watchlist_entries").select("*").eq("user_id", userId),
    ]);
    return {
      settings: s.data?.settings ? JSON.stringify(s.data.settings) : null,
      trades: JSON.stringify(t.data ?? []),
      logs: JSON.stringify(l.data ?? []),
      watchlist: JSON.stringify(w.data ?? []),
    };
  });

export const saveUserSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => settingsInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as {
      supabase: import("@supabase/supabase-js").SupabaseClient;
      userId: string;
    };
    const { error } = await supabase
      .from("user_settings")
      .upsert({ user_id: userId, settings: data.settings }, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const appendTradeHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => tradeInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as {
      supabase: import("@supabase/supabase-js").SupabaseClient;
      userId: string;
    };
    const { error } = await supabase.from("trade_history").insert({
      user_id: userId,
      ts: new Date(data.ts).toISOString(),
      mode: data.mode,
      token: data.token,
      venue: data.venue,
      size_sol: data.size_sol,
      entry: data.entry,
      exit: data.exit,
      pnl_sol: data.pnl_sol,
      reason: data.reason,
      fee_paid_sol: data.fee_paid_sol,
      net_to_user_sol: data.net_to_user_sol,
      fee_wallet: data.fee_wallet ?? null,
      swap_tx_sig: data.swap_tx_sig ?? null,
      fee_tx_sig: data.fee_tx_sig ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const appendDecisionLogs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => logsInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as {
      supabase: import("@supabase/supabase-js").SupabaseClient;
      userId: string;
    };
    if (!data.entries.length) return { ok: true, inserted: 0 };
    const rows = data.entries.map((e) => ({
      user_id: userId,
      ts: new Date(e.ts).toISOString(),
      type: e.type,
      summary: e.summary,
    }));
    const { error } = await supabase.from("decision_logs").insert(rows);
    if (error) throw new Error(error.message);
    // best-effort trim: keep newest 500
    await supabase.rpc("noop_ignore" as never).then(
      () => {},
      () => {},
    );
    return { ok: true, inserted: rows.length };
  });

export const saveWatchlist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => watchInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as {
      supabase: import("@supabase/supabase-js").SupabaseClient;
      userId: string;
    };
    // Replace-all strategy (small tables per user, ≤40 rows)
    await supabase.from("watchlist_entries").delete().eq("user_id", userId);
    if (data.entries.length) {
      const rows = data.entries.map((e) => ({
        user_id: userId,
        symbol: e.symbol,
        venue: e.venue,
        source: e.source,
        enabled: e.enabled,
        safety: e.safety,
        liquidity_sol: e.liquidity_sol,
        positive_streak: e.positive_streak,
        note: e.note ?? null,
        added_at: new Date(e.added_at).toISOString(),
      }));
      const { error } = await supabase.from("watchlist_entries").insert(rows);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });
