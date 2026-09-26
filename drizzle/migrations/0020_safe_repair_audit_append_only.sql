-- Safe Repair audit events are evidence, not mutable application state.
-- Keep the existing service-role administration grant, but make browser roles
-- append-only and replace the broad FOR ALL policy from the original table.
REVOKE UPDATE, DELETE ON public.vpip_repair_audit FROM anon, authenticated;

DROP POLICY IF EXISTS "open access" ON public.vpip_repair_audit;
CREATE POLICY "repair audit read" ON public.vpip_repair_audit
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "repair audit append" ON public.vpip_repair_audit
  FOR INSERT TO anon, authenticated WITH CHECK (true);
