-- Persist Modules 11A-15: prompt lifecycle/links + build, agent, repository and artifact history.

ALTER TABLE public.vpip_prompts
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'Draft',
  ADD COLUMN IF NOT EXISTS linked_decision_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS linked_requirement_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS linked_document_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS linked_discussion_ids jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS public.vpip_build_sessions (
  id text PRIMARY KEY,
  code text NOT NULL,
  project_id text NOT NULL REFERENCES public.vpip_projects(id) ON DELETE CASCADE,
  prompt_id text NOT NULL,
  prompt_title text NOT NULL DEFAULT '',
  prompt_kind text NOT NULL DEFAULT '',
  prompt_version integer NOT NULL DEFAULT 1,
  provider text,
  model text,
  status text NOT NULL DEFAULT 'Queued',
  context_package text NOT NULL DEFAULT '',
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  note text,
  turns jsonb NOT NULL DEFAULT '[]'::jsonb,
  files jsonb NOT NULL DEFAULT '[]'::jsonb,
  actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  terminal jsonb NOT NULL DEFAULT '[]'::jsonb,
  db_connections jsonb NOT NULL DEFAULT '[]'::jsonb,
  agent_tasks jsonb NOT NULL DEFAULT '[]'::jsonb,
  preview_entry_path text,
  repository_id text,
  repository_full_name text,
  repository_provider text,
  repository_branch text,
  last_commit_sha text,
  last_commit_at text,
  opened_at text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS vpip_build_sessions_project_idx ON public.vpip_build_sessions(project_id);

CREATE TABLE IF NOT EXISTS public.vpip_repositories (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES public.vpip_projects(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'GitHub',
  owner text NOT NULL DEFAULT '',
  name text NOT NULL DEFAULT '',
  full_name text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  visibility text NOT NULL DEFAULT 'private',
  default_branch text NOT NULL DEFAULT 'main',
  current_branch text NOT NULL DEFAULT 'main',
  html_url text NOT NULL DEFAULT '',
  token text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'Not Validated',
  status_message text,
  validated_at text,
  last_commit_sha text,
  last_commit_message text,
  last_commit_at text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS vpip_repositories_project_idx ON public.vpip_repositories(project_id);

CREATE TABLE IF NOT EXISTS public.vpip_repo_branches (
  id text PRIMARY KEY,
  repository_id text NOT NULL REFERENCES public.vpip_repositories(id) ON DELETE CASCADE,
  name text NOT NULL,
  sha text NOT NULL DEFAULT '',
  base_branch text,
  created_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS vpip_repo_branches_repo_idx ON public.vpip_repo_branches(repository_id);

CREATE TABLE IF NOT EXISTS public.vpip_repo_commits (
  id text PRIMARY KEY,
  repository_id text NOT NULL,
  project_id text NOT NULL REFERENCES public.vpip_projects(id) ON DELETE CASCADE,
  sha text NOT NULL,
  message text NOT NULL DEFAULT '',
  branch text NOT NULL DEFAULT '',
  files jsonb NOT NULL DEFAULT '[]'::jsonb,
  html_url text,
  author text NOT NULL DEFAULT '',
  build_session_id text,
  build_code text,
  prompt_id text,
  prompt_title text,
  prompt_version integer,
  decision_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  requirement_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  provider text,
  model text,
  created_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS vpip_repo_commits_project_idx ON public.vpip_repo_commits(project_id);

CREATE TABLE IF NOT EXISTS public.vpip_artifacts (
  id text PRIMARY KEY,
  code text NOT NULL,
  project_id text NOT NULL REFERENCES public.vpip_projects(id) ON DELETE CASCADE,
  type text NOT NULL,
  name text NOT NULL,
  path text NOT NULL,
  content text NOT NULL DEFAULT '',
  size integer NOT NULL DEFAULT 0,
  build_session_id text,
  build_code text,
  build_record_id text,
  build_run_code text,
  task_id text,
  task_code text,
  prompt_id text,
  prompt_title text,
  prompt_version integer,
  decision_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  requirement_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  repository_full_name text,
  branch text,
  commit_sha text,
  provider text,
  model text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS vpip_artifacts_project_idx ON public.vpip_artifacts(project_id);

CREATE TABLE IF NOT EXISTS public.vpip_build_records (
  id text PRIMARY KEY,
  code text NOT NULL,
  project_id text NOT NULL REFERENCES public.vpip_projects(id) ON DELETE CASCADE,
  build_session_id text NOT NULL DEFAULT '',
  build_code text NOT NULL DEFAULT '',
  repository_id text,
  repository_full_name text,
  branch text,
  commit_sha text,
  prompt_id text NOT NULL DEFAULT '',
  prompt_title text NOT NULL DEFAULT '',
  prompt_version integer NOT NULL DEFAULT 1,
  provider text,
  model text,
  status text NOT NULL DEFAULT 'Queued',
  started_at text NOT NULL,
  ended_at text,
  summary text,
  output text,
  logs jsonb NOT NULL DEFAULT '[]'::jsonb,
  artifact_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  decision_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  requirement_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at text NOT NULL,
  updated_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS vpip_build_records_project_idx ON public.vpip_build_records(project_id);

CREATE TABLE IF NOT EXISTS public.vpip_change_records (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES public.vpip_projects(id) ON DELETE CASCADE,
  action text NOT NULL,
  path text NOT NULL,
  from_path text,
  build_session_id text,
  build_code text,
  build_record_id text,
  build_run_code text,
  task_id text,
  task_code text,
  prompt_id text,
  provider text,
  model text,
  created_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS vpip_change_records_project_idx ON public.vpip_change_records(project_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vpip_build_sessions TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vpip_repositories TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vpip_repo_branches TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vpip_repo_commits TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vpip_artifacts TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vpip_build_records TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vpip_change_records TO anon, authenticated;
GRANT ALL ON public.vpip_build_sessions TO service_role;
GRANT ALL ON public.vpip_repositories TO service_role;
GRANT ALL ON public.vpip_repo_branches TO service_role;
GRANT ALL ON public.vpip_repo_commits TO service_role;
GRANT ALL ON public.vpip_artifacts TO service_role;
GRANT ALL ON public.vpip_build_records TO service_role;
GRANT ALL ON public.vpip_change_records TO service_role;

ALTER TABLE public.vpip_build_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vpip_repositories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vpip_repo_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vpip_repo_commits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vpip_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vpip_build_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vpip_change_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "open access" ON public.vpip_build_sessions;
DROP POLICY IF EXISTS "open access" ON public.vpip_repositories;
DROP POLICY IF EXISTS "open access" ON public.vpip_repo_branches;
DROP POLICY IF EXISTS "open access" ON public.vpip_repo_commits;
DROP POLICY IF EXISTS "open access" ON public.vpip_artifacts;
DROP POLICY IF EXISTS "open access" ON public.vpip_build_records;
DROP POLICY IF EXISTS "open access" ON public.vpip_change_records;

CREATE POLICY "open access" ON public.vpip_build_sessions FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "open access" ON public.vpip_repositories FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "open access" ON public.vpip_repo_branches FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "open access" ON public.vpip_repo_commits FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "open access" ON public.vpip_artifacts FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "open access" ON public.vpip_build_records FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "open access" ON public.vpip_change_records FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
