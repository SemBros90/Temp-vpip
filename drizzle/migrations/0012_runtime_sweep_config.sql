CREATE SCHEMA IF NOT EXISTS vpip_private;
REVOKE ALL ON SCHEMA vpip_private FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS vpip_private.cron_config (key text PRIMARY KEY, value text NOT NULL);
REVOKE ALL ON vpip_private.cron_config FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA vpip_private TO sandbox_exec;
GRANT INSERT, UPDATE, SELECT ON vpip_private.cron_config TO sandbox_exec;