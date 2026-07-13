CREATE TABLE public.council_memory (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cycle_id TEXT NOT NULL,
  agent TEXT NOT NULL CHECK (agent IN ('scout','auditor','council')),
  summary TEXT NOT NULL,
  insights JSONB NOT NULL DEFAULT '{}'::jsonb,
  pnl_delta_sol NUMERIC(18,9) NOT NULL DEFAULT 0,
  trades_in_window INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX council_memory_user_created_idx ON public.council_memory (user_id, created_at DESC);
GRANT SELECT, INSERT, DELETE ON public.council_memory TO authenticated;
GRANT ALL ON public.council_memory TO service_role;
ALTER TABLE public.council_memory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own council memory" ON public.council_memory FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);