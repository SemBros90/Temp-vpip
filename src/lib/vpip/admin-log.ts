/** Append-only Admin AI action log (vpip_admin_ai_actions). Rows can be added and read, never edited or deleted. */
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { from: (t: string) => any };

export interface AdminAction {
  id: string;
  action: string;
  status: string;
  report_id: string | null;
  snapshot_id: string | null;
  branch: string | null;
  commit_sha: string | null;
  pr_number: number | null;
  pr_url: string | null;
  files: string[];
  detail: Record<string, unknown>;
  created_at: string;
}

export type AdminActionInput = Partial<Omit<AdminAction, "id" | "created_at">> & { action: string };

/** Never throws: logging failure must not break the action, but it is reported in the console. */
export async function logAdminAction(a: AdminActionInput) {
  const { error } = await db.from("vpip_admin_ai_actions").insert({ status: "ok", files: [], detail: {}, ...a });
  if (error) console.error("[Admin AI] action log failed:", error.message);
}

export async function listAdminActions(limit = 300): Promise<AdminAction[]> {
  const { data, error } = await db.from("vpip_admin_ai_actions").select("*").order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}
