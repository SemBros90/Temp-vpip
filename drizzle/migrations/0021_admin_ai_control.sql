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
  CONSTRAINT vpip_admin_ai_modules_level CHECK (access_level IN ('disconnected','read_only','read_analyze','read_analyze_recommend','full'))
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
CREATE TABLE public.vpip_admin_ai_request_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origin_module text NOT NULL,
  actor text NOT NULL DEFAULT 'Platform owner',
  provider text NOT NULL,
  model text NOT NULL,
  prompt_preview text,
  prompt_size integer NOT NULL,
  response_size integer,
  status text NOT NULL,
  response_ms integer,
  token_count integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.vpip_admin_ai_response_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid REFERENCES public.vpip_admin_ai_request_history(id),
  origin_module text NOT NULL,
  response_summary text,
  duration_ms integer NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vpip_admin_ai_request_history_created_idx ON public.vpip_admin_ai_request_history (created_at DESC);
CREATE INDEX vpip_admin_ai_response_history_created_idx ON public.vpip_admin_ai_response_history (created_at DESC);
CREATE INDEX vpip_admin_ai_routes_created_idx ON public.vpip_admin_ai_routes (created_at DESC);
GRANT SELECT, INSERT, UPDATE ON public.vpip_admin_ai_control, public.vpip_admin_ai_modules TO anon, authenticated;
GRANT SELECT, INSERT ON public.vpip_admin_ai_routes TO anon, authenticated;
GRANT SELECT ON public.vpip_admin_ai_request_history, public.vpip_admin_ai_response_history TO anon, authenticated;
GRANT ALL ON public.vpip_admin_ai_control, public.vpip_admin_ai_modules, public.vpip_admin_ai_routes, public.vpip_admin_ai_request_history, public.vpip_admin_ai_response_history TO service_role;
ALTER TABLE public.vpip_admin_ai_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vpip_admin_ai_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vpip_admin_ai_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vpip_admin_ai_request_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vpip_admin_ai_response_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "single owner control read" ON public.vpip_admin_ai_control FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "single owner control insert" ON public.vpip_admin_ai_control FOR INSERT TO anon, authenticated WITH CHECK (id = 'default');
CREATE POLICY "single owner control update" ON public.vpip_admin_ai_control FOR UPDATE TO anon, authenticated USING (id = 'default') WITH CHECK (id = 'default');
CREATE POLICY "single owner modules read" ON public.vpip_admin_ai_modules FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "single owner modules insert" ON public.vpip_admin_ai_modules FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "single owner modules update" ON public.vpip_admin_ai_modules FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "single owner routes read" ON public.vpip_admin_ai_routes FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "single owner routes append" ON public.vpip_admin_ai_routes FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "request history read" ON public.vpip_admin_ai_request_history FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "response history read" ON public.vpip_admin_ai_response_history FOR SELECT TO anon, authenticated USING (true);
ALTER PUBLICATION supabase_realtime ADD TABLE public.vpip_admin_ai_control, public.vpip_admin_ai_modules, public.vpip_admin_ai_request_history, public.vpip_admin_ai_response_history;