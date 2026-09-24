DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['vpip_activity','vpip_artifacts','vpip_build_records','vpip_build_sessions','vpip_change_records','vpip_context_packages','vpip_discussions','vpip_documents','vpip_failures','vpip_intelligence','vpip_knowledge','vpip_outcomes','vpip_phase_runs','vpip_projects','vpip_prompt_phases','vpip_prompts','vpip_repair_audit','vpip_repair_proposals','vpip_repo_branches','vpip_repo_commits','vpip_repo_env','vpip_repo_reports','vpip_repo_snapshots','vpip_repositories','vpip_settings','vpip_snapshots','vpip_validation_runs']
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO anon', t);
    EXECUTE format('CREATE POLICY "single-owner access" ON public.%I FOR ALL TO anon USING (true) WITH CHECK (true)', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['vpip_runtime_sandboxes','vpip_runtime_audit']
  LOOP
    EXECUTE format('GRANT SELECT ON public.%I TO anon', t);
    EXECUTE format('CREATE POLICY "single-owner read" ON public.%I FOR SELECT TO anon USING (true)', t);
  END LOOP;
END $$;
ALTER TABLE public.vpip_runtime_sandboxes DROP CONSTRAINT IF EXISTS vpip_runtime_sandboxes_owner_id_fkey;
COMMENT ON TABLE public.vpip_project_members IS 'DEPRECATED: VPIP is single-owner; user membership is not used.';