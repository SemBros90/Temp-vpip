ALTER ROLE anon SET statement_timeout = '30s';
NOTIFY pgrst, 'reload config';