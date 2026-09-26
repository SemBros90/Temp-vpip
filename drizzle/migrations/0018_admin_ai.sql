CREATE TABLE public.vpip_admin_ai_settings (
  id text PRIMARY KEY DEFAULT 'default',
  repo_full_name text NOT NULL DEFAULT '',
  branch text NOT NULL DEFAULT '',
  token text NOT NULL DEFAULT '',
  engine text NOT NULL DEFAULT 'lovable',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.vpip_admin_ai_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role text NOT NULL,
  content text NOT NULL,
  engine text,
  model text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.vpip_admin_ai_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  status text NOT NULL DEFAULT 'Pending Review',
  engine text,
  model text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.vpip_admin_ai_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vpip_admin_ai_settings, public.vpip_admin_ai_messages, public.vpip_admin_ai_reports, public.vpip_admin_ai_feedback TO anon, authenticated;
GRANT ALL ON public.vpip_admin_ai_settings, public.vpip_admin_ai_messages, public.vpip_admin_ai_reports, public.vpip_admin_ai_feedback TO service_role;
ALTER TABLE public.vpip_admin_ai_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vpip_admin_ai_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vpip_admin_ai_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vpip_admin_ai_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "single owner access" ON public.vpip_admin_ai_settings FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "single owner access" ON public.vpip_admin_ai_messages FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "single owner access" ON public.vpip_admin_ai_reports FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "single owner access" ON public.vpip_admin_ai_feedback FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);