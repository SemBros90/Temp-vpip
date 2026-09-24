CREATE TABLE public.vpip_repo_reports (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES public.vpip_projects(id) ON DELETE CASCADE,
  repository_id text REFERENCES public.vpip_repositories(id) ON DELETE CASCADE,
  build_session_id text,
  branch text NOT NULL DEFAULT '',
  commit_sha text,
  classification jsonb NOT NULL DEFAULT '{}'::jsonb,
  dependencies jsonb NOT NULL DEFAULT '[]'::jsonb,
  imports jsonb NOT NULL DEFAULT '[]'::jsonb,
  aliases jsonb NOT NULL DEFAULT '[]'::jsonb,
  environment jsonb NOT NULL DEFAULT '[]'::jsonb,
  unsupported jsonb NOT NULL DEFAULT '[]'::jsonb,
  preview_diagnostics jsonb NOT NULL DEFAULT '{}'::jsonb,
  health jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at text NOT NULL
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vpip_repo_reports TO anon, authenticated;
GRANT ALL ON public.vpip_repo_reports TO service_role;
ALTER TABLE public.vpip_repo_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open access" ON public.vpip_repo_reports FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE INDEX vpip_repo_reports_project_idx ON public.vpip_repo_reports(project_id);
CREATE INDEX vpip_repo_reports_repo_idx ON public.vpip_repo_reports(repository_id);

CREATE TABLE public.vpip_repo_env (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES public.vpip_projects(id) ON DELETE CASCADE,
  repository_id text NOT NULL REFERENCES public.vpip_repositories(id) ON DELETE CASCADE,
  key text NOT NULL,
  value text NOT NULL DEFAULT '',
  updated_at text NOT NULL,
  UNIQUE (repository_id, key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vpip_repo_env TO anon, authenticated;
GRANT ALL ON public.vpip_repo_env TO service_role;
ALTER TABLE public.vpip_repo_env ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open access" ON public.vpip_repo_env FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.vpip_repositories ADD COLUMN IF NOT EXISTS last_push_at text, ADD COLUMN IF NOT EXISTS classification jsonb;