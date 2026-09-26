-- Central policy and routing registry for every Admin AI request.  These rows
-- are deliberately separate from Admin AI's repository settings so access can
-- be revoked without changing provider credentials or repository metadata.
CREATE TABLE public.vpip_admin_ai_control (
  id text PRIMARY KEY DEFAULT 'default',
  enabled boolean NOT NULL DEFAULT false,
  emergency_off boolean NOT NULL DEFAULT false,
  provider text NOT NULL DEFAULT 'lovable',
  model text NOT NULL DEFAULT 'openai/gpt-6-astra',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.vpip_admin_ai_modules (
  module_key text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  access_level text NOT NULL DEFAULT 'disconnected',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vpip_admin_ai_modules_level CHECK (access_level IN ('disconnected', 'read_only', 'read_analyze', 'read_analyze_recommend', 'full'))
);
CREATE TABLE public.vpip_admin_ai_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origin_module text NOT NULL,
  actor text NOT NULL DEFAULT 'Platform owner',
  provider text NOT NULL,
  model text NOT NULL,
  status text NOT NULL,
  prompt_preview text,
  response_ms integer,
  token_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.vpip_admin_ai_control, public.vpip_admin_ai_modules TO anon, authenticated;
GRANT SELECT, INSERT ON public.vpip_admin_ai_routes TO anon, authenticated;
GRANT ALL ON public.vpip_admin_ai_control, public.vpip_admin_ai_modules, public.vpip_admin_ai_routes TO service_role;
ALTER TABLE public.vpip_admin_ai_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vpip_admin_ai_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vpip_admin_ai_routes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "single owner control" ON public.vpip_admin_ai_control FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "single owner modules" ON public.vpip_admin_ai_modules FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "single owner routes read" ON public.vpip_admin_ai_routes FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "single owner routes append" ON public.vpip_admin_ai_routes FOR INSERT TO anon, authenticated WITH CHECK (true);
