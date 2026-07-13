/**
 * Server functions for council memory persistence.
 * Best-effort: if the user isn't signed in, we silently skip.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getOptionalPersistenceAuth } from "@/lib/persistence-auth.server";

const appendInput = z.object({
  cycle_id: z.string().min(1).max(64),
  agent: z.enum(["scout", "auditor", "council"]),
  summary: z.string().min(1).max(2000),
  insights_json: z.string().max(20_000),
  pnl_delta_sol: z.number(),
  trades_in_window: z.number().int().min(0),
});

export const appendCouncilMemory = createServerFn({ method: "POST" })
  .inputValidator((raw) => appendInput.parse(raw))
  .handler(async ({ data }) => {
    const auth = await getOptionalPersistenceAuth();
    if (!auth) return { ok: false, skipped: true };
    const { supabase, userId } = auth;
    let insights: unknown;
    try {
      insights = JSON.parse(data.insights_json);
    } catch {
      throw new Error("insights_json must be valid JSON");
    }
    // Cast: council_memory may not yet be in generated types for a fresh
    // migration — server accepts it either way.
    const { error } = await supabase.from("council_memory" as never).insert({
      user_id: userId,
      cycle_id: data.cycle_id,
      agent: data.agent,
      summary: data.summary,
      insights: insights as never,
      pnl_delta_sol: data.pnl_delta_sol,
      trades_in_window: data.trades_in_window,
    } as never);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export interface CouncilMemoryRow {
  id: string;
  cycle_id: string;
  agent: "scout" | "auditor" | "council";
  summary: string;
  insights: Record<string, unknown>;
  pnl_delta_sol: number;
  trades_in_window: number;
  created_at: string;
}

export const loadCouncilMemory = createServerFn({ method: "POST" })
  .inputValidator((raw) =>
    z.object({ limit: z.number().int().min(1).max(200).default(60) }).parse(raw),
  )
  .handler(async ({ data }): Promise<{ ok: boolean; entries: CouncilMemoryRow[] }> => {
    const auth = await getOptionalPersistenceAuth();
    if (!auth) return { ok: false, entries: [] };
    const { supabase, userId } = auth;
    const { data: rows, error } = await supabase
      .from("council_memory" as never)
      .select("id,cycle_id,agent,summary,insights,pnl_delta_sol,trades_in_window,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);
    return { ok: true, entries: ((rows ?? []) as unknown as CouncilMemoryRow[]) };
  });
