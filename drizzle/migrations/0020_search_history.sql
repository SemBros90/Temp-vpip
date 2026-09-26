CREATE TABLE public.vpip_search_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  term text NOT NULL,
  search_type text NOT NULL,
  user_label text NOT NULL DEFAULT 'owner',
  repository text NOT NULL DEFAULT '',
  branch text NOT NULL DEFAULT '',
  result_count integer NOT NULL DEFAULT 0,
  files_matched integer NOT NULL DEFAULT 0,
  duration_ms integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.vpip_search_history TO anon, authenticated;
GRANT ALL ON public.vpip_search_history TO service_role;
ALTER TABLE public.vpip_search_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "search history read" ON public.vpip_search_history FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "search history insert" ON public.vpip_search_history FOR INSERT TO anon, authenticated WITH CHECK (true);