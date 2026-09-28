/** Central authorization, registration, and audit boundary for Admin AI. */
import { supabase } from "@/integrations/supabase/client";
import { logAdminAction } from "./admin-log";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { from: (table: string) => any };

export const ADMIN_MODULES = [
  ["home", "Home"], ["chat", "Admin AI Chat"], ["explorer", "Repository Explorer"], ["search", "Search Center"],
  ["dependency", "Dependency Analyzer"], ["github", "GitHub Center"], ["snapshots", "Snapshot Center"],
  ["actionLog", "Action Log"], ["ai1", "AI1 Center"], ["ai2", "AI2 Center"],
  ["knowledge", "Knowledge Base"], ["rootCause", "Root Cause Engine"], ["runtime", "Runtime Center"],
  ["proposals", "Change Proposal Center"], ["accessibility", "Accessibility Center"],
] as const;
export type AdminModuleKey = (typeof ADMIN_MODULES)[number][0];
export type AccessLevel = "disconnected" | "read_only" | "read_analyze" | "read_analyze_recommend" | "full";
export const ACCESS_LABEL: Record<AccessLevel, string> = { disconnected: "Disconnect", read_only: "Read Only", read_analyze: "Read + Analyze", read_analyze_recommend: "Read + Analyze + Recommend", full: "Full AI Access" };

export interface ControlState { enabled: boolean; emergency_off: boolean; provider: string; model: string }
export interface ModuleState { module_key: AdminModuleKey; enabled: boolean; access_level: AccessLevel; updated_at?: string }

export async function getControlState(): Promise<{ control: ControlState; modules: ModuleState[]; requests: any[]; responses: any[] }> {
  const [controlResult, moduleResult, requestResult, responseResult] = await Promise.all([
    db.from("vpip_admin_ai_control").select("*").eq("id", "default").maybeSingle(),
    db.from("vpip_admin_ai_modules").select("*").order("module_key"),
    db.from("vpip_admin_ai_request_history").select("*").order("created_at", { ascending: false }).limit(100),
    db.from("vpip_admin_ai_response_history").select("*").order("created_at", { ascending: false }).limit(100),
  ]);
  const control = controlResult.data ?? { enabled: false, emergency_off: false, provider: "lovable", model: "openai/gpt-6-astra" };
  const loaded = new Map<string, ModuleState>(((moduleResult.data ?? []) as ModuleState[]).map((row) => [row.module_key, row]));
  const modules = ADMIN_MODULES.map(([module_key]) => loaded.get(module_key) ?? { module_key, enabled: false, access_level: "disconnected" as AccessLevel });
  return { control, modules, requests: requestResult.data ?? [], responses: responseResult.data ?? [] };
}

export async function setModuleAccess(module_key: AdminModuleKey, access_level: AccessLevel, actor = "Platform owner") {
  const enabled = access_level !== "disconnected";
  const { error } = await db.from("vpip_admin_ai_modules").upsert({ module_key, access_level, enabled, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
  await logAdminAction({ action: enabled ? "admin_ai_module_connect" : "admin_ai_module_disconnect", actor, status: "ok", detail: { module: module_key, access_level } });
}

export async function setEntirePanel(connect: boolean, actor = "Platform owner") {
  const { data: previous } = await db.from("vpip_admin_ai_control").select("emergency_off").eq("id", "default").maybeSingle();
  const rows = ADMIN_MODULES.map(([module_key]) => ({ module_key, enabled: connect, access_level: connect ? "read_analyze_recommend" : "disconnected", updated_at: new Date().toISOString() }));
  const { error } = await db.from("vpip_admin_ai_modules").upsert(rows);
  if (error) throw new Error(error.message);
  await db.from("vpip_admin_ai_control").upsert({ id: "default", enabled: connect, emergency_off: false, updated_at: new Date().toISOString() });
  await logAdminAction({ action: connect ? "admin_ai_panel_connect" : "admin_ai_panel_disconnect", actor, status: "ok", detail: { modules: rows.map((row) => row.module_key), result: `${rows.length} modules ${connect ? "connected" : "disconnected"}` } });
  if (connect && previous?.emergency_off) await logAdminAction({ action: "admin_ai_emergency_off_disabled", actor, status: "ok", detail: { scope: "entire Admin Panel", reason: "panel reconnected" } });
}

/** Provider choice is data, not a module binding: VPIP can add adapters without changing module permissions. */
export async function setControlProvider(provider: string, model: string, actor = "Platform owner") {
  const { error } = await db.from("vpip_admin_ai_control").upsert({ id: "default", provider, model, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
  await logAdminAction({ action: "admin_ai_provider_change", actor, status: "ok", detail: { provider, model } });
}

export async function setEmergencyOff(actor = "Platform owner") {
  const { error } = await db.from("vpip_admin_ai_control").upsert({ id: "default", enabled: false, emergency_off: true, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
  await setEntirePanel(false, actor);
  await db.from("vpip_admin_ai_control").upsert({ id: "default", enabled: false, emergency_off: true, updated_at: new Date().toISOString() });
  await logAdminAction({ action: "admin_ai_emergency_off", actor, status: "ok", detail: { scope: "entire Admin Panel" } });
}

/** Live updates: fires on any change to control, modules or request/response history. */
let channelSeq = 0;
export function subscribeControl(onChange: () => void): () => void {
  const channel = supabase.channel(`admin-ai-control-${++channelSeq}`);
  for (const table of ["vpip_admin_ai_control", "vpip_admin_ai_modules", "vpip_admin_ai_request_history", "vpip_admin_ai_response_history"]) {
    channel.on("postgres_changes" as never, { event: "*", schema: "public", table } as never, onChange);
  }
  channel.subscribe();
  return () => { void supabase.removeChannel(channel); };
}

export async function assertAdminAiAccess(module: AdminModuleKey) {
  const { control, modules } = await getControlState();
  const entry = modules.find((item) => item.module_key === module);
  if (control.emergency_off) throw new Error("Admin AI is disabled by the emergency kill switch.");
  if (!control.enabled || !entry?.enabled) throw new Error(`Admin AI access is disconnected for ${module}. Connect it in Admin AI Control.`);
  return { provider: control.provider, model: control.model, access: entry.access_level };
}
