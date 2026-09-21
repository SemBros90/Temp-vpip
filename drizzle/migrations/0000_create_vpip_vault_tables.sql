-- VPIP vault: shared workspace, no accounts. Open read/write by design.

CREATE TABLE public.vpip_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  author text NOT NULL DEFAULT 'You',
  default_provider text NOT NULL DEFAULT 'openai',
  auto_save_interval_sec integer NOT NULL DEFAULT 30,
  project_root_label text NOT NULL DEFAULT 'Projects',
  backup_folder_label text NOT NULL DEFAULT 'Backups',
  providers jsonb NOT NULL DEFAULT '{}'::jsonb,
  saved_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.vpip_projects (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.vpip_discussions (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES public.vpip_projects(id) ON DELETE CASCADE,
  title text NOT NULL,
  type text NOT NULL DEFAULT 'General',
  summary text,
  messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vpip_discussions_project_idx ON public.vpip_discussions(project_id);

CREATE TABLE public.vpip_knowledge (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES public.vpip_projects(id) ON DELETE CASCADE,
  code text NOT NULL,
  type text NOT NULL,
  status text NOT NULL DEFAULT 'candidate',
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  source_discussion_id text,
  source_discussion_title text,
  source_messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  provider text,
  author text NOT NULL DEFAULT 'You',
  revisions jsonb NOT NULL DEFAULT '[]'::jsonb,
  merged_from jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vpip_knowledge_project_idx ON public.vpip_knowledge(project_id);

CREATE TABLE public.vpip_documents (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES public.vpip_projects(id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL,
  markdown text NOT NULL DEFAULT '',
  provider text,
  model text,
  source_discussion_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vpip_documents_project_idx ON public.vpip_documents(project_id);

CREATE TABLE public.vpip_prompts (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES public.vpip_projects(id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  markdown text NOT NULL DEFAULT '',
  provider text,
  model text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vpip_prompts_project_idx ON public.vpip_prompts(project_id);

CREATE TABLE public.vpip_snapshots (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES public.vpip_projects(id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL,
  ref_id text NOT NULL,
  markdown text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vpip_snapshots_project_idx ON public.vpip_snapshots(project_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vpip_settings TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vpip_projects TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vpip_discussions TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vpip_knowledge TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vpip_documents TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vpip_prompts TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vpip_snapshots TO anon, authenticated;
GRANT ALL ON public.vpip_settings TO service_role;
GRANT ALL ON public.vpip_projects TO service_role;
GRANT ALL ON public.vpip_discussions TO service_role;
GRANT ALL ON public.vpip_knowledge TO service_role;
GRANT ALL ON public.vpip_documents TO service_role;
GRANT ALL ON public.vpip_prompts TO service_role;
GRANT ALL ON public.vpip_snapshots TO service_role;

ALTER TABLE public.vpip_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vpip_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vpip_discussions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vpip_knowledge ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vpip_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vpip_prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vpip_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "open access" ON public.vpip_settings FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "open access" ON public.vpip_projects FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "open access" ON public.vpip_discussions FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "open access" ON public.vpip_knowledge FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "open access" ON public.vpip_documents FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "open access" ON public.vpip_prompts FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "open access" ON public.vpip_snapshots FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

INSERT INTO public.vpip_settings (id, providers) VALUES (1, '{"openai":{"apiKey":"","model":"gpt-4o-mini","baseUrl":"https://api.openai.com/v1","status":"unknown"},"deepseek":{"apiKey":"","model":"deepseek-chat","baseUrl":"https://api.deepseek.com/v1","status":"unknown"}}'::jsonb);
