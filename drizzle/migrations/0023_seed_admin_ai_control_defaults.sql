-- Make a fresh canonical Admin AI installation operable without enabling an
-- AI provider.  These records intentionally start disconnected: an operator
-- must still explicitly connect the panel or individual modules in Admin AI
-- Control before any request can reach a provider.
INSERT INTO public.admin_ai_settings (
  id,
  ai_enabled,
  emergency_stop,
  provider,
  model,
  connection_status,
  active_module_count
)
VALUES (
  'default',
  false,
  false,
  'lovable',
  'openai/gpt-6-astra',
  'disconnected',
  0
)
ON CONFLICT (id) DO NOTHING;

-- The Lovable gateway is the no-key default used by the Admin AI route.  A
-- provider record only makes it selectable; it does not enable Admin AI.
INSERT INTO public.admin_ai_providers (provider_name, model_name, enabled)
VALUES ('lovable', 'openai/gpt-6-astra', true)
ON CONFLICT (provider_name, model_name) DO NOTHING;

-- Keep the registry aligned with every Admin AI section that can request AI.
-- Existing installations retain their configured module rows unchanged.
INSERT INTO public.admin_ai_modules (
  module_name,
  ai_enabled,
  permission_level,
  connection_status,
  last_connected_at
)
VALUES
  ('home', false, 'disconnected', 'disconnected', NULL),
  ('chat', false, 'disconnected', 'disconnected', NULL),
  ('explorer', false, 'disconnected', 'disconnected', NULL),
  ('search', false, 'disconnected', 'disconnected', NULL),
  ('dependency', false, 'disconnected', 'disconnected', NULL),
  ('github', false, 'disconnected', 'disconnected', NULL),
  ('snapshots', false, 'disconnected', 'disconnected', NULL),
  ('actionLog', false, 'disconnected', 'disconnected', NULL),
  ('ai1', false, 'disconnected', 'disconnected', NULL),
  ('ai2', false, 'disconnected', 'disconnected', NULL),
  ('knowledge', false, 'disconnected', 'disconnected', NULL),
  ('rootCause', false, 'disconnected', 'disconnected', NULL),
  ('runtime', false, 'disconnected', 'disconnected', NULL),
  ('proposals', false, 'disconnected', 'disconnected', NULL),
  ('accessibility', false, 'disconnected', 'disconnected', NULL)
ON CONFLICT (module_name) DO NOTHING;

-- Correct the derived count without changing enabled state or permissions.
UPDATE public.admin_ai_settings
SET active_module_count = (
  SELECT count(*)
  FROM public.admin_ai_modules
  WHERE ai_enabled
)
WHERE id = 'default';
