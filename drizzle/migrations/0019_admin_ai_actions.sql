CREATE TABLE public.vpip_admin_ai_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL,
  status text NOT NULL DEFAULT 'ok',
  report_id uuid,
  snapshot_id uuid,
  branch text,
  commit_sha text,
  pr_number integer,
  pr_url text,
  files jsonb NOT NULL DEFAULT '[]'::jsonb,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.vpip_admin_ai_actions TO anon, authenticated;
GRANT ALL ON public.vpip_admin_ai_actions TO service_role;
ALTER TABLE public.vpip_admin_ai_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "single owner read" ON public.vpip_admin_ai_actions FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "single owner append" ON public.vpip_admin_ai_actions FOR INSERT TO anon, authenticated WITH CHECK (true);