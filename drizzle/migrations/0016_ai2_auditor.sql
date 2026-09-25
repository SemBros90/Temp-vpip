CREATE TABLE public.vpip_ai2_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id text NOT NULL,
  build_session_id text NOT NULL,
  kind text NOT NULL,
  mode text NOT NULL,
  engine text,
  model text,
  score integer,
  findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  report text NOT NULL DEFAULT '',
  corrective_prompt text NOT NULL DEFAULT '',
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.vpip_ai2_audits (build_session_id, created_at DESC);
CREATE TABLE public.vpip_ai2_settings (
  build_session_id text PRIMARY KEY,
  project_id text NOT NULL,
  continuous boolean NOT NULL DEFAULT false,
  mode text NOT NULL DEFAULT 'audit_prompt',
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vpip_ai2_audits TO anon, authenticated;
GRANT ALL ON public.vpip_ai2_audits TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vpip_ai2_settings TO anon, authenticated;
GRANT ALL ON public.vpip_ai2_settings TO service_role;
ALTER TABLE public.vpip_ai2_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vpip_ai2_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "single owner access" ON public.vpip_ai2_audits FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "single owner access" ON public.vpip_ai2_settings FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);