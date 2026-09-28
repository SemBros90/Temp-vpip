-- VPIP is deployed as a single-owner application (see 0010).  The canonical
-- Admin AI migration accidentally restricted these control records to JWTs
-- carrying app_metadata.role = 'admin', but the browser client does not add
-- that claim.  RLS consequently returned an empty settings result and made
-- Admin AI Control appear unconfigured even when its rows existed.

GRANT SELECT, INSERT, UPDATE ON public.admin_ai_settings, public.admin_ai_modules, public.admin_ai_providers TO anon, authenticated;
GRANT SELECT ON public.admin_ai_runtime_status TO anon, authenticated;
GRANT SELECT, INSERT ON public.admin_ai_actions TO anon, authenticated;

DROP POLICY IF EXISTS "admin settings full access" ON public.admin_ai_settings;
DROP POLICY IF EXISTS "admin modules full access" ON public.admin_ai_modules;
DROP POLICY IF EXISTS "admin providers full access" ON public.admin_ai_providers;
DROP POLICY IF EXISTS "admin actions append and read" ON public.admin_ai_actions;
DROP POLICY IF EXISTS "admin actions append" ON public.admin_ai_actions;
DROP POLICY IF EXISTS "admin runtime status full access" ON public.admin_ai_runtime_status;

CREATE POLICY "single owner admin settings access"
  ON public.admin_ai_settings FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY "single owner admin modules access"
  ON public.admin_ai_modules FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY "single owner admin providers access"
  ON public.admin_ai_providers FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

-- The action log remains append-only: no UPDATE or DELETE grant or policy is
-- created for either browser role.
CREATE POLICY "single owner admin actions read"
  ON public.admin_ai_actions FOR SELECT TO anon, authenticated
  USING (true);
CREATE POLICY "single owner admin actions append"
  ON public.admin_ai_actions FOR INSERT TO anon, authenticated
  WITH CHECK (true);
CREATE POLICY "single owner admin runtime status read"
  ON public.admin_ai_runtime_status FOR SELECT TO anon, authenticated
  USING (true);
