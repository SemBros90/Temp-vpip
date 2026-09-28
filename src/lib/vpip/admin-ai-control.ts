/** Compatibility boundary backed exclusively by the canonical Admin AI tables. */
import {
  getAdminAiConfiguration,
  getModules,
  getProviders,
  getSettings,
  updateModule,
  updateSettings,
  writeActionLog,
  type AdminAiModule,
  type PermissionLevel,
} from "@/lib/admin-ai-service";
import { supabase } from "@/integrations/supabase/client";

export type AdminModuleKey = string;
export type AccessLevel = PermissionLevel;
export const ACCESS_LABEL: Record<AccessLevel, string> = { disconnected: "Disconnect", read_only: "Read Only", read_analyze: "Read + Analyze", read_analyze_recommend: "Read + Analyze + Recommend", full: "Full AI Access" };
export interface ControlState { enabled: boolean; emergency_off: boolean; provider: string; model: string; connection_status: string }
export interface ModuleState { id: string; module_key: string; enabled: boolean; access_level: AccessLevel; connection_status: string; updated_at?: string }

const state = (m: AdminAiModule): ModuleState => ({ id: m.id, module_key: m.module_name, enabled: m.ai_enabled, access_level: m.permission_level, connection_status: m.connection_status, updated_at: m.updated_at });
export async function getControlState() {
  const { settings, modules, providers, runtime } = await getAdminAiConfiguration();
  // Recover safely if a database was created before the seed migration ran.
  // updateSettings persists a complete, disconnected singleton; it never
  // enables a provider or module as part of this repair.
  const controlSettings = settings ?? await updateSettings({});
  return { control: { enabled: controlSettings.ai_enabled, emergency_off: controlSettings.emergency_stop, provider: controlSettings.provider, model: controlSettings.model, connection_status: controlSettings.connection_status }, modules: modules.map(state), providers, runtime, requests: [], responses: [] };
}
export async function setModuleAccess(module: ModuleState, access_level: AccessLevel, actor = "Platform owner") {
  const enabled = access_level !== "disconnected";
  await updateModule(module.id, { ai_enabled: enabled, permission_level: access_level, connection_status: enabled ? "connected" : "disconnected", last_connected_at: enabled ? new Date().toISOString() : null });
  await updateSettings({ active_module_count: (await getModules()).filter((item) => item.ai_enabled).length });
  await writeActionLog(enabled ? "module_connect" : "module_disconnect", module.module_key, "completed", { actor, permission_level: access_level });
}
export async function setEntirePanel(connect: boolean, actor = "Platform owner") {
  const modules = await getModules();
  await Promise.all(modules.map((m) => updateModule(m.id, { ai_enabled: connect, permission_level: connect ? "read_analyze_recommend" : "disconnected", connection_status: connect ? "connected" : "disconnected", last_connected_at: connect ? new Date().toISOString() : null })));
  await updateSettings({ ai_enabled: connect, emergency_stop: false, connection_status: connect ? "connected" : "disconnected", active_module_count: connect ? modules.length : 0 });
  await writeActionLog(connect ? "panel_connect" : "panel_disconnect", null, "completed", { actor, module_count: modules.length });
}
export async function setControlProvider(provider: string, model: string, actor = "Platform owner") {
  const available = await getProviders();
  if (!available.some((entry) => entry.enabled && entry.provider_name === provider && entry.model_name === model)) {
    throw new Error(`The ${provider} / ${model} provider model is not available in Admin AI Control.`);
  }
  await updateSettings({ provider, model });
  await writeActionLog("provider_change", null, "completed", { actor, provider, model });
}
export async function setEmergencyOff(actor = "Platform owner") {
  const modules = await getModules();
  await Promise.all(modules.map((m) => updateModule(m.id, { ai_enabled: false, permission_level: "disconnected", connection_status: "disconnected", last_connected_at: null })));
  await updateSettings({ ai_enabled: false, emergency_stop: true, connection_status: "emergency_stopped", active_module_count: 0 });
  await writeActionLog("emergency_stop", null, "completed", { actor, module_count: modules.length });
}
let channelSeq = 0;
export function subscribeControl(onChange: () => void): () => void {
  const channel = supabase.channel(`admin-ai-canonical-${++channelSeq}`);
  for (const table of ["admin_ai_settings", "admin_ai_modules", "admin_ai_providers", "admin_ai_runtime_status"]) channel.on("postgres_changes" as never, { event: "*", schema: "public", table } as never, onChange);
  channel.subscribe();
  return () => { void supabase.removeChannel(channel); };
}
export async function assertAdminAiAccess(module: AdminModuleKey) {
  const settings = await getSettings();
  const entry = (await getModules()).find((item) => item.module_name === module);
  if (!settings) throw new Error("Admin AI settings have not been configured in the database.");
  if (settings.emergency_stop) throw new Error("Admin AI is disabled by the emergency kill switch.");
  if (!settings.ai_enabled || !entry?.ai_enabled || entry.permission_level === "disconnected") throw new Error(`Admin AI access is disconnected for ${module}. Connect it in Admin AI Control.`);
  return { provider: settings.provider, model: settings.model, access: entry.permission_level };
}
