CREATE TABLE public.vpip_runtime_providers (
  id text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT false,
  last_test_at timestamptz,
  last_test_ok boolean,
  last_test_message text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.vpip_runtime_providers TO anon;
GRANT ALL ON public.vpip_runtime_providers TO service_role;
ALTER TABLE public.vpip_runtime_providers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "single-owner read" ON public.vpip_runtime_providers FOR SELECT TO anon USING (true);
COMMENT ON TABLE public.vpip_runtime_providers IS 'Runtime provider connection state (no credentials; credentials live in the secure secret store).';
COMMENT ON FUNCTION public.is_project_member(text, uuid) IS 'DEPRECATED: retired multi-user member model; VPIP is single-owner.';
COMMENT ON TABLE public.vpip_project_members IS 'DEPRECATED: retired multi-user member model; not used by any code. VPIP is single-owner.';