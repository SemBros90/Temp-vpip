ALTER TABLE public.vpip_build_sessions
  ADD COLUMN IF NOT EXISTS requirements jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS build_plan jsonb,
  ADD COLUMN IF NOT EXISTS validation jsonb;