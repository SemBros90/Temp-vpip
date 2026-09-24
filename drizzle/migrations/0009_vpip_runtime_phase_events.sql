ALTER TABLE public.vpip_runtime_sandboxes ADD COLUMN phase_events_seen integer NOT NULL DEFAULT 0;
ALTER TABLE public.vpip_runtime_sandboxes ADD COLUMN phase_events jsonb NOT NULL DEFAULT '[]'::jsonb;