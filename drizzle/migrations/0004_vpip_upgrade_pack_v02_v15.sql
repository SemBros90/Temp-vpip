-- V-03 prompt phases
CREATE TABLE public.vpip_prompt_phases (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES public.vpip_projects(id) ON DELETE CASCADE,
  prompt_id text NOT NULL,
  phase_no integer NOT NULL DEFAULT 1,
  title text NOT NULL DEFAULT '',
  markdown text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'Pending',
  started_at text,
  ended_at text,
  output text,
  error text,
  provider text,
  model text,
  build_session_id text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vpip_prompt_phases TO anon, authenticated;
GRANT ALL ON public.vpip_prompt_phases TO service_role;
ALTER TABLE public.vpip_prompt_phases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open access" ON public.vpip_prompt_phases FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE INDEX vpip_prompt_phases_project_idx ON public.vpip_prompt_phases(project_id);
CREATE INDEX vpip_prompt_phases_prompt_idx ON public.vpip_prompt_phases(prompt_id);

-- V-03 phase run history
CREATE TABLE public.vpip_phase_runs (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES public.vpip_projects(id) ON DELETE CASCADE,
  phase_id text NOT NULL,
  prompt_id text NOT NULL DEFAULT '',
  attempt integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'Pending',
  provider text,
  model text,
  started_at text NOT NULL,
  ended_at text,
  output text,
  error text,
  created_at text NOT NULL
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vpip_phase_runs TO anon, authenticated;
GRANT ALL ON public.vpip_phase_runs TO service_role;
ALTER TABLE public.vpip_phase_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open access" ON public.vpip_phase_runs FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE INDEX vpip_phase_runs_project_idx ON public.vpip_phase_runs(project_id);
CREATE INDEX vpip_phase_runs_phase_idx ON public.vpip_phase_runs(phase_id);

-- V-05 context packages
CREATE TABLE public.vpip_context_packages (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES public.vpip_projects(id) ON DELETE CASCADE,
  code text NOT NULL DEFAULT '',
  title text NOT NULL DEFAULT '',
  prompt_id text,
  prompt_title text,
  prompt_version integer,
  markdown text NOT NULL DEFAULT '',
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  decision_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  requirement_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  document_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  discussion_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  prompt_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  provider text,
  model text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vpip_context_packages TO anon, authenticated;
GRANT ALL ON public.vpip_context_packages TO service_role;
ALTER TABLE public.vpip_context_packages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open access" ON public.vpip_context_packages FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE INDEX vpip_context_packages_project_idx ON public.vpip_context_packages(project_id);

-- V-06 outcomes
CREATE TABLE public.vpip_outcomes (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES public.vpip_projects(id) ON DELETE CASCADE,
  code text NOT NULL DEFAULT '',
  subject_type text NOT NULL DEFAULT 'Build',
  subject_id text NOT NULL DEFAULT '',
  subject_label text NOT NULL DEFAULT '',
  result text NOT NULL DEFAULT 'Success',
  notes text NOT NULL DEFAULT '',
  lessons text NOT NULL DEFAULT '',
  recommendations text NOT NULL DEFAULT '',
  provider text,
  model text,
  author text NOT NULL DEFAULT 'You',
  created_at text NOT NULL,
  updated_at text NOT NULL
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vpip_outcomes TO anon, authenticated;
GRANT ALL ON public.vpip_outcomes TO service_role;
ALTER TABLE public.vpip_outcomes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open access" ON public.vpip_outcomes FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE INDEX vpip_outcomes_project_idx ON public.vpip_outcomes(project_id);
CREATE INDEX vpip_outcomes_subject_idx ON public.vpip_outcomes(subject_id);

-- V-07 failures
CREATE TABLE public.vpip_failures (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES public.vpip_projects(id) ON DELETE CASCADE,
  code text NOT NULL DEFAULT '',
  subject_type text NOT NULL DEFAULT 'Build',
  subject_id text NOT NULL DEFAULT '',
  subject_label text NOT NULL DEFAULT '',
  title text NOT NULL DEFAULT '',
  root_cause text NOT NULL DEFAULT '',
  resolution text NOT NULL DEFAULT '',
  lessons text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'Open',
  build_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  prompt_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  requirement_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  decision_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  provider text,
  model text,
  author text NOT NULL DEFAULT 'You',
  created_at text NOT NULL,
  updated_at text NOT NULL
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vpip_failures TO anon, authenticated;
GRANT ALL ON public.vpip_failures TO service_role;
ALTER TABLE public.vpip_failures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open access" ON public.vpip_failures FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE INDEX vpip_failures_project_idx ON public.vpip_failures(project_id);
CREATE INDEX vpip_failures_subject_idx ON public.vpip_failures(subject_id);

-- V-11 multi-AI activity ledger
CREATE TABLE public.vpip_activity (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES public.vpip_projects(id) ON DELETE CASCADE,
  subject_type text NOT NULL DEFAULT '',
  subject_id text NOT NULL DEFAULT '',
  subject_label text NOT NULL DEFAULT '',
  action text NOT NULL DEFAULT '',
  provider text,
  model text,
  author text NOT NULL DEFAULT 'You',
  note text NOT NULL DEFAULT '',
  created_at text NOT NULL
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vpip_activity TO anon, authenticated;
GRANT ALL ON public.vpip_activity TO service_role;
ALTER TABLE public.vpip_activity ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open access" ON public.vpip_activity FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE INDEX vpip_activity_project_idx ON public.vpip_activity(project_id);
CREATE INDEX vpip_activity_subject_idx ON public.vpip_activity(subject_id);

-- V-15 organizational intelligence register
CREATE TABLE public.vpip_intelligence (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES public.vpip_projects(id) ON DELETE CASCADE,
  code text NOT NULL DEFAULT '',
  pattern_type text NOT NULL DEFAULT 'Success Pattern',
  title text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_project_id text,
  source_project_name text,
  source_kind text,
  source_id text,
  provider text,
  model text,
  author text NOT NULL DEFAULT 'You',
  created_at text NOT NULL,
  updated_at text NOT NULL
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vpip_intelligence TO anon, authenticated;
GRANT ALL ON public.vpip_intelligence TO service_role;
ALTER TABLE public.vpip_intelligence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open access" ON public.vpip_intelligence FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE INDEX vpip_intelligence_project_idx ON public.vpip_intelligence(project_id);

-- additive columns on existing tables
ALTER TABLE public.vpip_knowledge ADD COLUMN IF NOT EXISTS reason_for_change text;
ALTER TABLE public.vpip_knowledge ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE public.vpip_knowledge ADD COLUMN IF NOT EXISTS source_kind text NOT NULL DEFAULT 'Discussion';
ALTER TABLE public.vpip_knowledge ADD COLUMN IF NOT EXISTS source_ref_id text;

ALTER TABLE public.vpip_build_sessions ADD COLUMN IF NOT EXISTS context_package_id text;
ALTER TABLE public.vpip_build_sessions ADD COLUMN IF NOT EXISTS source_document_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.vpip_build_sessions ADD COLUMN IF NOT EXISTS source_discussion_ids jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.vpip_repo_commits ADD COLUMN IF NOT EXISTS release_tag text;
ALTER TABLE public.vpip_repo_commits ADD COLUMN IF NOT EXISTS release_name text;

ALTER TABLE public.vpip_discussions ADD COLUMN IF NOT EXISTS reopened_at text;
ALTER TABLE public.vpip_discussions ADD COLUMN IF NOT EXISTS reopen_context jsonb NOT NULL DEFAULT '[]'::jsonb;