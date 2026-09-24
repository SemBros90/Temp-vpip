-- 1. Whole-app sign-in: existing tables become signed-in only (policy names/tables unchanged otherwise)
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_policies WHERE schemaname='public' AND policyname='open access' LOOP
    EXECUTE format('DROP POLICY "open access" ON public.%I', t);
    EXECUTE format('CREATE POLICY "signed-in access" ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
  END LOOP;
END $$;

-- 2. Project membership (runtime ownership / authorized users)
CREATE TABLE public.vpip_project_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id text NOT NULL REFERENCES public.vpip_projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id)
);
GRANT SELECT ON public.vpip_project_members TO authenticated;
GRANT ALL ON public.vpip_project_members TO service_role;
ALTER TABLE public.vpip_project_members ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_project_member(_project_id text, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.vpip_project_members WHERE project_id = _project_id AND user_id = _user_id)
$$;

CREATE POLICY "members read project members" ON public.vpip_project_members
  FOR SELECT TO authenticated USING (public.is_project_member(project_id, auth.uid()));

-- 3. Sandboxes (one per build session)
CREATE TABLE public.vpip_runtime_sandboxes (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES public.vpip_projects(id) ON DELETE CASCADE,
  build_id text NOT NULL REFERENCES public.vpip_build_sessions(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  e2b_sandbox_id text,
  status text NOT NULL DEFAULT 'none',
  phase text NOT NULL DEFAULT 'none',
  package_manager text,
  node_version text,
  node_source text,
  dev_command text,
  port integer NOT NULL DEFAULT 5173,
  preview_slug text,
  sync_status text NOT NULL DEFAULT 'never',
  last_sync_at timestamptz,
  sync_stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  sync_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  env_report jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text,
  last_active_at timestamptz NOT NULL DEFAULT now(),
  running_since timestamptz,
  runtime_seconds numeric NOT NULL DEFAULT 0,
  destroyed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX vpip_runtime_sandboxes_build_active ON public.vpip_runtime_sandboxes(build_id) WHERE destroyed_at IS NULL;
CREATE INDEX vpip_runtime_sandboxes_project ON public.vpip_runtime_sandboxes(project_id);
CREATE INDEX vpip_runtime_sandboxes_active ON public.vpip_runtime_sandboxes(last_active_at) WHERE destroyed_at IS NULL;
GRANT SELECT ON public.vpip_runtime_sandboxes TO authenticated;
GRANT ALL ON public.vpip_runtime_sandboxes TO service_role;
ALTER TABLE public.vpip_runtime_sandboxes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read sandboxes" ON public.vpip_runtime_sandboxes
  FOR SELECT TO authenticated USING (public.is_project_member(project_id, auth.uid()));

-- 4. Sandbox credentials: server only, never readable by browsers
CREATE TABLE public.vpip_runtime_secrets (
  sandbox_row_id text PRIMARY KEY REFERENCES public.vpip_runtime_sandboxes(id) ON DELETE CASCADE,
  envd_token text,
  traffic_token text,
  domain text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.vpip_runtime_secrets TO service_role;
ALTER TABLE public.vpip_runtime_secrets ENABLE ROW LEVEL SECURITY;

-- 5. Runtime audit
CREATE TABLE public.vpip_runtime_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id text NOT NULL REFERENCES public.vpip_projects(id) ON DELETE CASCADE,
  build_id text,
  sandbox_row_id text,
  e2b_sandbox_id text,
  user_id uuid,
  user_email text,
  action text NOT NULL,
  status text NOT NULL,
  duration_ms integer,
  error text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vpip_runtime_audit_project ON public.vpip_runtime_audit(project_id, created_at DESC);
CREATE INDEX vpip_runtime_audit_sandbox ON public.vpip_runtime_audit(sandbox_row_id, created_at DESC);
GRANT SELECT ON public.vpip_runtime_audit TO authenticated;
GRANT ALL ON public.vpip_runtime_audit TO service_role;
ALTER TABLE public.vpip_runtime_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read runtime audit" ON public.vpip_runtime_audit
  FOR SELECT TO authenticated USING (public.is_project_member(project_id, auth.uid()));