
-- user_settings: single row per user, JSONB blob
CREATE TABLE public.user_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_settings TO authenticated;
GRANT ALL ON public.user_settings TO service_role;
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own settings" ON public.user_settings
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_user_settings_updated BEFORE UPDATE ON public.user_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- trade_history
CREATE TABLE public.trade_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  mode TEXT NOT NULL CHECK (mode IN ('paper','live')),
  token TEXT NOT NULL,
  venue TEXT NOT NULL,
  size_sol NUMERIC NOT NULL,
  entry NUMERIC NOT NULL,
  exit NUMERIC NOT NULL,
  pnl_sol NUMERIC NOT NULL,
  reason TEXT NOT NULL,
  fee_paid_sol NUMERIC NOT NULL DEFAULT 0,
  net_to_user_sol NUMERIC NOT NULL DEFAULT 0,
  fee_wallet TEXT,
  swap_tx_sig TEXT,
  fee_tx_sig TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trade_history TO authenticated;
GRANT ALL ON public.trade_history TO service_role;
ALTER TABLE public.trade_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own trades" ON public.trade_history
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX trade_history_user_ts_idx ON public.trade_history (user_id, ts DESC);

-- decision_logs
CREATE TABLE public.decision_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  type TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.decision_logs TO authenticated;
GRANT ALL ON public.decision_logs TO service_role;
ALTER TABLE public.decision_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own logs" ON public.decision_logs
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX decision_logs_user_ts_idx ON public.decision_logs (user_id, ts DESC);

-- watchlist_entries
CREATE TABLE public.watchlist_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  venue TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('manual','auto')),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  safety INT NOT NULL DEFAULT 0,
  liquidity_sol NUMERIC NOT NULL DEFAULT 0,
  positive_streak INT NOT NULL DEFAULT 0,
  note TEXT,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, symbol, venue)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.watchlist_entries TO authenticated;
GRANT ALL ON public.watchlist_entries TO service_role;
ALTER TABLE public.watchlist_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own watchlist" ON public.watchlist_entries
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_watchlist_updated BEFORE UPDATE ON public.watchlist_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
