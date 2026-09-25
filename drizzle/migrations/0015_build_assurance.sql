CREATE TABLE public.vpip_build_assurance (
  build_session_id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES public.vpip_projects(id) ON DELETE CASCADE,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  assumptions jsonb NOT NULL DEFAULT '[]'::jsonb,
  repair_mode text NOT NULL DEFAULT 'approval',
  last_report jsonb,
  audit jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vpip_build_assurance TO anon, authenticated;
GRANT ALL ON public.vpip_build_assurance TO service_role;
ALTER TABLE public.vpip_build_assurance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "single owner access" ON public.vpip_build_assurance FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);