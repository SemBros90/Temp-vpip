/**
 * Canonical Admin AI configuration store.
 *
 * The Admin Panel and the server-side runtime deliberately use these table
 * names. Do not replace a missing row with an in-memory default: a missing
 * record is a configuration error that must be shown to the operator.
 */
import { supabase } from "@/integrations/supabase/client";

// The migration and generated Supabase types are deployed independently.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { from: (table: string) => any };

export type PermissionLevel = "disconnected" | "read_only" | "read_analyze" | "read_analyze_recommend" | "full";
export interface AdminAiSettings { id: string; ai_enabled: boolean; emergency_stop: boolean; provider: string; model: string; connection_status: string; last_activity: string | null; active_module_count: number; created_at: string; updated_at: string }
export interface AdminAiModule { id: string; module_name: string; ai_enabled: boolean; permission_level: PermissionLevel; connection_status: string; last_connected_at: string | null; created_at: string; updated_at: string }
export interface AdminAiProvider { id: string; provider_name: string; model_name: string; api_endpoint: string | null; enabled: boolean; created_at: string; updated_at: string }
export interface AdminAiRuntimeStatus { id: string; repository_health: string; runtime_health: string; validation_health: string; snapshot_health: string; knowledge_health: string; risk_critical: number; risk_high: number; risk_medium: number; risk_low: number; updated_at: string }

/**
 * `upsert` inserts when the singleton is absent. Keep every NOT NULL column
 * here so partial updates (for example selecting a provider) can never create
 * an invalid settings record.
 */
const DEFAULT_SETTINGS = {
  id: "default",
  ai_enabled: false,
  emergency_stop: false,
  provider: "lovable",
  model: "openai/gpt-6-astra",
  connection_status: "disconnected",
  active_module_count: 0,
};

async function result<T>(query: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

export async function getSettings(): Promise<AdminAiSettings | null> {
  return result<AdminAiSettings | null>(db.from("admin_ai_settings").select("*").eq("id", "default").maybeSingle());
}
export async function updateSettings(changes: Partial<Omit<AdminAiSettings, "id" | "created_at" | "updated_at">>): Promise<AdminAiSettings> {
  // Read first so an update never resets unrelated control state. If a
  // deployment is missing the singleton, the defaults below form a complete,
  // intentionally disconnected row rather than a partial invalid insert.
  const current = await getSettings();
  return result<AdminAiSettings>(db.from("admin_ai_settings").upsert({ ...DEFAULT_SETTINGS, ...current, ...changes, updated_at: new Date().toISOString() }).select("*").single());
}
export async function getModules(): Promise<AdminAiModule[]> {
  return result<AdminAiModule[]>(db.from("admin_ai_modules").select("*").order("module_name"));
}
export async function updateModule(id: string, changes: Partial<Omit<AdminAiModule, "id" | "created_at" | "updated_at">>): Promise<AdminAiModule> {
  return result<AdminAiModule>(db.from("admin_ai_modules").update({ ...changes, updated_at: new Date().toISOString() }).eq("id", id).select("*").single());
}
export async function getProviders(): Promise<AdminAiProvider[]> {
  return result<AdminAiProvider[]>(db.from("admin_ai_providers").select("*").order("provider_name").order("model_name"));
}
export async function updateProvider(id: string, changes: Partial<Omit<AdminAiProvider, "id" | "created_at" | "updated_at">>): Promise<AdminAiProvider> {
  return result<AdminAiProvider>(db.from("admin_ai_providers").update({ ...changes, updated_at: new Date().toISOString() }).eq("id", id).select("*").single());
}
export async function writeActionLog(action_type: string, module_name: string | null, status: string, details: Record<string, unknown> = {}): Promise<void> {
  await result(db.from("admin_ai_actions").insert({ action_type, module_name, status, details }));
}
export async function getRuntimeStatus(): Promise<AdminAiRuntimeStatus | null> {
  return result<AdminAiRuntimeStatus | null>(db.from("admin_ai_runtime_status").select("*").eq("id", "default").maybeSingle());
}

export async function getAdminAiConfiguration() {
  const [settings, modules, providers, runtime] = await Promise.all([getSettings(), getModules(), getProviders(), getRuntimeStatus()]);
  return { settings, modules, providers, runtime };
}
