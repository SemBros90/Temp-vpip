-- Admin AI Control renders its provider and model selectors from
-- admin_ai_providers.  Seed every provider/model supported by the runtime so
-- the operator can select any configured gateway from the Control screen.
-- This does not enable Admin AI or any module.
INSERT INTO public.admin_ai_providers (provider_name, model_name, enabled)
VALUES
  ('lovable', 'openai/gpt-6-astra', true),
  ('openai', 'gpt-4o', true),
  ('openai', 'gpt-4o-mini', true),
  ('openai', 'gpt-4.1', true),
  ('openai', 'gpt-4.1-mini', true),
  ('openai', 'o4-mini', true),
  ('deepseek', 'deepseek-chat', true),
  ('deepseek', 'deepseek-reasoner', true),
  ('deepseek', 'deepseek-v4-pro', true),
  ('perplexity', 'perplexity/sonar', true),
  ('perplexity', 'perplexity/deepseek-v4-pro-0813', true),
  ('perplexity', 'perplexity/kimi-k3', true),
  ('perplexity', 'perplexity/glm-5.3', true),
  ('Gemini', 'gemini-2.5-flash', true),
  ('Gemini', 'gemini-2.5-pro', true),
  ('Gemini', 'gemini-2.0-flash', true),
  ('Claude', 'claude-sonnet-4-5', true),
  ('Claude', 'claude-3-7-sonnet-latest', true),
  ('Claude', 'claude-3-5-haiku-latest', true)
ON CONFLICT (provider_name, model_name) DO NOTHING;
