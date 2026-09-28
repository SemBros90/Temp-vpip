-- Canonical source of truth for both the Admin Panel and Admin AI runtime.
-- No rows are seeded: an administrator must configure real provider/module
-- records before the UI or runtime enables Admin AI.
CREATE TABLE public.admin_ai_settings (
  id text PRIMARY KEY DEFAULT 'default',
  ai_enabled boolean NOT NULL,
  emergency_stop boolean NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  connection_status text NOT NULL,
  last_activity timestamptz,
  active_module_count integer NOT NULL CHECK (active_module_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_ai_settings_singleton CHECK (id = 'default')
);
CREATE TABLE public.admin_ai_modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_name text NOT NULL UNIQUE,
  ai_enabled boolean NOT NULL,
  permission_level text NOT NULL CHECK (permission_level IN ('disconnected', 'read_only', 'read_analyze', 'read_analyze_recommend', 'full')),
  connection_status text NOT NULL,
  last_connected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.admin_ai_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_name text NOT NULL,
  model_name text NOT NULL,
  api_endpoint text,
  enabled boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_name, model_name)
);
CREATE TABLE public.admin_ai_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), action_type text NOT NULL, module_name text,
  status text NOT NULL, details jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.admin_ai_runtime_status (
  id text PRIMARY KEY DEFAULT 'default', repository_health text NOT NULL, runtime_health text NOT NULL,
  validation_health text NOT NULL, snapshot_health text NOT NULL, knowledge_health text NOT NULL,
  risk_critical integer NOT NULL CHECK (risk_critical >= 0), risk_high integer NOT NULL CHECK (risk_high >= 0),
  risk_medium integer NOT NULL CHECK (risk_medium >= 0), risk_low integer NOT NULL CHECK (risk_low >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT admin_ai_runtime_status_singleton CHECK (id = 'default')
);

-- Preserve existing real configuration when upgrading installations that used
-- the earlier vpip_admin_ai_* split tables.
INSERT INTO public.admin_ai_settings (id, ai_enabled, emergency_stop, provider, model, connection_status, active_module_count, updated_at)
SELECT id, enabled, emergency_off, provider, model, CASE WHEN emergency_off THEN 'emergency_stopped' WHEN enabled THEN 'connected' ELSE 'disconnected' END, 0, updated_at
FROM public.vpip_admin_ai_control WHERE id = 'default' ON CONFLICT (id) DO NOTHING;
INSERT INTO public.admin_ai_modules (module_name, ai_enabled, permission_level, connection_status, last_connected_at, updated_at)
SELECT module_key, enabled, access_level, CASE WHEN enabled THEN 'connected' ELSE 'disconnected' END, CASE WHEN enabled THEN updated_at ELSE NULL END, updated_at
FROM public.vpip_admin_ai_modules ON CONFLICT (module_name) DO NOTHING;
UPDATE public.admin_ai_settings SET active_module_count = (SELECT count(*) FROM public.admin_ai_modules WHERE ai_enabled) WHERE id = 'default';

CREATE OR REPLACE FUNCTION public.admin_ai_is_admin() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false);
$$;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.admin_ai_settings, public.admin_ai_modules, public.admin_ai_providers, public.admin_ai_runtime_status TO authenticated;
GRANT SELECT, INSERT ON public.admin_ai_actions TO authenticated;
-- Runtime uses the service role as a read-only configuration consumer.
GRANT SELECT ON public.admin_ai_settings, public.admin_ai_modules, public.admin_ai_providers, public.admin_ai_runtime_status, public.admin_ai_actions TO service_role;
ALTER TABLE public.admin_ai_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_ai_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_ai_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_ai_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_ai_runtime_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin settings full access" ON public.admin_ai_settings FOR ALL TO authenticated USING (public.admin_ai_is_admin()) WITH CHECK (public.admin_ai_is_admin());
CREATE POLICY "admin modules full access" ON public.admin_ai_modules FOR ALL TO authenticated USING (public.admin_ai_is_admin()) WITH CHECK (public.admin_ai_is_admin());
CREATE POLICY "admin providers full access" ON public.admin_ai_providers FOR ALL TO authenticated USING (public.admin_ai_is_admin()) WITH CHECK (public.admin_ai_is_admin());
CREATE POLICY "admin actions append and read" ON public.admin_ai_actions FOR SELECT TO authenticated USING (public.admin_ai_is_admin());
CREATE POLICY "admin actions append" ON public.admin_ai_actions FOR INSERT TO authenticated WITH CHECK (public.admin_ai_is_admin());
CREATE POLICY "admin runtime status full access" ON public.admin_ai_runtime_status FOR ALL TO authenticated USING (public.admin_ai_is_admin()) WITH CHECK (public.admin_ai_is_admin());
ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_ai_settings, public.admin_ai_modules, public.admin_ai_providers, public.admin_ai_runtime_status;
