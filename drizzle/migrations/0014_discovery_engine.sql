CREATE TABLE public.vpip_discovery_sessions (
  id text PRIMARY KEY, project_id text NOT NULL REFERENCES public.vpip_projects(id) ON DELETE CASCADE,
  idea text NOT NULL, status text NOT NULL DEFAULT 'active', maturity integer NOT NULL DEFAULT 0,
  readiness jsonb NOT NULL DEFAULT '{}'::jsonb, recommendation text NOT NULL DEFAULT '', round integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.vpip_discovery_questions (
  id text PRIMARY KEY, session_id text NOT NULL REFERENCES public.vpip_discovery_sessions(id) ON DELETE CASCADE,
  round integer NOT NULL, qtype text NOT NULL, text text NOT NULL, choices jsonb NOT NULL DEFAULT '[]'::jsonb,
  category text NOT NULL, priority integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.vpip_discovery_answers (
  id text PRIMARY KEY, session_id text NOT NULL REFERENCES public.vpip_discovery_sessions(id) ON DELETE CASCADE,
  question_id text NOT NULL REFERENCES public.vpip_discovery_questions(id) ON DELETE CASCADE,
  kind text NOT NULL, value jsonb NOT NULL DEFAULT '[]'::jsonb, other text, is_active boolean NOT NULL DEFAULT true,
  superseded_by text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.vpip_discovery_knowledge (
  id text PRIMARY KEY, session_id text NOT NULL REFERENCES public.vpip_discovery_sessions(id) ON DELETE CASCADE,
  category text NOT NULL, status text NOT NULL, statement text NOT NULL, source text NOT NULL DEFAULT 'ai',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.vpip_discovery_outputs (
  id text PRIMARY KEY, session_id text NOT NULL REFERENCES public.vpip_discovery_sessions(id) ON DELETE CASCADE,
  version integer NOT NULL, kind text NOT NULL, markdown text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.vpip_discovery_audit (
  id text PRIMARY KEY, project_id text NOT NULL REFERENCES public.vpip_projects(id) ON DELETE CASCADE,
  session_id text REFERENCES public.vpip_discovery_sessions(id) ON DELETE CASCADE, actor text NOT NULL DEFAULT 'Owner',
  event text NOT NULL, detail jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now());
DO $$ DECLARE t text; BEGIN
FOREACH t IN ARRAY ARRAY['vpip_discovery_sessions','vpip_discovery_questions','vpip_discovery_answers','vpip_discovery_knowledge','vpip_discovery_outputs','vpip_discovery_audit'] LOOP
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO anon, authenticated', t);
  EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('CREATE POLICY "single-owner access" ON public.%I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)', t);
END LOOP; END $$;
CREATE INDEX ON public.vpip_discovery_audit(project_id, created_at DESC);