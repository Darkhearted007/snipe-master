ALTER TABLE public.trade_history
  ADD COLUMN IF NOT EXISTS client_id text,
  ADD COLUMN IF NOT EXISTS settlement_status text NOT NULL DEFAULT 'n/a';

CREATE INDEX IF NOT EXISTS trade_history_user_client_idx
  ON public.trade_history (user_id, client_id);