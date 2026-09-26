-- Execution evidence is kept separately from configuration and the append-only
-- action audit.  Values are written by the server route which actually calls a
-- provider; the UI only reads them.
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
GRANT SELECT ON public.vpip_admin_ai_request_history, public.vpip_admin_ai_response_history TO anon, authenticated;
GRANT ALL ON public.vpip_admin_ai_request_history, public.vpip_admin_ai_response_history TO service_role;
ALTER TABLE public.vpip_admin_ai_request_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vpip_admin_ai_response_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "request history read" ON public.vpip_admin_ai_request_history FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "response history read" ON public.vpip_admin_ai_response_history FOR SELECT TO anon, authenticated USING (true);
