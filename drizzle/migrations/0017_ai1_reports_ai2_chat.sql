CREATE TABLE public.vpip_ai1_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id text NOT NULL,
  build_session_id text NOT NULL,
  report text NOT NULL,
  files_created jsonb NOT NULL DEFAULT '[]',
  files_modified jsonb NOT NULL DEFAULT '[]',
  sent_to_ai2 boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.vpip_ai1_reports TO anon, authenticated, service_role;
ALTER TABLE public.vpip_ai1_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "single owner access" ON public.vpip_ai1_reports FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE INDEX ON public.vpip_ai1_reports (build_session_id, created_at DESC);

CREATE TABLE public.vpip_ai2_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id text NOT NULL,
  build_session_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('user','assistant','report')),
  content text NOT NULL,
  engine text,
  model text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.vpip_ai2_messages TO anon, authenticated, service_role;
ALTER TABLE public.vpip_ai2_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "single owner access" ON public.vpip_ai2_messages FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE INDEX ON public.vpip_ai2_messages (build_session_id, created_at);