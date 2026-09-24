CREATE TABLE public.vpip_repo_snapshots (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES public.vpip_projects(id) ON DELETE CASCADE,
  repository_id text,
  build_session_id text,
  label text NOT NULL,
  is_zero boolean NOT NULL DEFAULT false,
  files jsonb NOT NULL DEFAULT '[]',
  tree jsonb NOT NULL DEFAULT '[]',
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at text NOT NULL
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vpip_repo_snapshots TO anon, authenticated;
GRANT ALL ON public.vpip_repo_snapshots TO service_role;
ALTER TABLE public.vpip_repo_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open access" ON public.vpip_repo_snapshots FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE INDEX vpip_repo_snapshots_project_idx ON public.vpip_repo_snapshots(project_id);

CREATE TABLE public.vpip_repair_proposals (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES public.vpip_projects(id) ON DELETE CASCADE,
  repository_id text,
  build_session_id text,
  simulation_id text NOT NULL,
  classification text NOT NULL,
  risk text NOT NULL,
  confidence integer NOT NULL,
  confidence_note text NOT NULL,
  problem text NOT NULL,
  fix text NOT NULL,
  impact jsonb NOT NULL DEFAULT '{}',
  files jsonb NOT NULL DEFAULT '[]',
  dependencies jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'Proposed',
  approved_files jsonb NOT NULL DEFAULT '[]',
  snapshot_id text,
  created_at text NOT NULL,
  decided_at text,
  decided_by text
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vpip_repair_proposals TO anon, authenticated;
GRANT ALL ON public.vpip_repair_proposals TO service_role;
ALTER TABLE public.vpip_repair_proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open access" ON public.vpip_repair_proposals FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE INDEX vpip_repair_proposals_project_idx ON public.vpip_repair_proposals(project_id);

CREATE TABLE public.vpip_repair_audit (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES public.vpip_projects(id) ON DELETE CASCADE,
  repository_id text,
  "user" text NOT NULL,
  action text NOT NULL,
  change_type text,
  risk text,
  confidence integer,
  files jsonb NOT NULL DEFAULT '[]',
  dependencies jsonb NOT NULL DEFAULT '[]',
  note text NOT NULL DEFAULT '',
  created_at text NOT NULL
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vpip_repair_audit TO anon, authenticated;
GRANT ALL ON public.vpip_repair_audit TO service_role;
ALTER TABLE public.vpip_repair_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open access" ON public.vpip_repair_audit FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE INDEX vpip_repair_audit_project_idx ON public.vpip_repair_audit(project_id);

CREATE TABLE public.vpip_validation_runs (
  id text PRIMARY KEY,
  targets jsonb NOT NULL DEFAULT '[]',
  results jsonb NOT NULL DEFAULT '[]',
  metrics jsonb NOT NULL DEFAULT '{}',
  created_at text NOT NULL
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vpip_validation_runs TO anon, authenticated;
GRANT ALL ON public.vpip_validation_runs TO service_role;
ALTER TABLE public.vpip_validation_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open access" ON public.vpip_validation_runs FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.vpip_repo_reports ADD COLUMN IF NOT EXISTS ingestion jsonb, ADD COLUMN IF NOT EXISTS readiness jsonb;