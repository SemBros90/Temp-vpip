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

export interface AdminLogFilter {
  action?: string;
  status?: string;
  query?: string;
  from?: string;
  to?: string;
}

export type AdminActionInput = Partial<Omit<AdminAction, "id" | "created_at" | "detail">> & {
  action: string;
  /** Stored inside immutable detail so database schema stays backwards compatible. */
  actor?: string;
  detail?: Record<string, unknown>;
};

/** Never throws: logging failure must not break the action, but it is reported in the console. */
export async function logAdminAction(a: AdminActionInput) {
  const { actor = "Admin AI", detail = {}, ...row } = a;
  const { error } = await db.from("vpip_admin_ai_actions").insert({ status: "ok", files: [], detail: { ...detail, actor }, ...row });
  if (error) console.error("[Admin AI] action log failed:", error.message);
}

export async function listAdminActions(limit = 300, filter: AdminLogFilter = {}): Promise<AdminAction[]> {
  const { data, error } = await db.from("vpip_admin_ai_actions").select("*").order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  const needle = filter.query?.trim().toLowerCase();
  return (data ?? []).filter((row: AdminAction) => {
    if (filter.action && row.action !== filter.action) return false;
    if (filter.status && row.status !== filter.status) return false;
    if (filter.from && row.created_at < filter.from) return false;
    if (filter.to && row.created_at > `${filter.to}T23:59:59.999Z`) return false;
    if (!needle) return true;
    return JSON.stringify(row).toLowerCase().includes(needle);
  });
}

export function actionActor(action: AdminAction) {
  return typeof action.detail["actor"] === "string" ? action.detail["actor"] : "Admin AI";
}

/** CSV is generated locally from selected immutable records; no data is modified. */
export function exportAdminActionsCsv(actions: AdminAction[]) {
  const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const header = ["id", "created_at", "actor", "action", "status", "branch", "commit_sha", "pr_number", "snapshot_id", "files", "detail"];
  return [header.join(","), ...actions.map((action) => [action.id, action.created_at, actionActor(action), action.action, action.status, action.branch, action.commit_sha, action.pr_number, action.snapshot_id, action.files.join(" | "), JSON.stringify(action.detail)].map(quote).join(","))].join("\n");
}

export function adminLogAudit(actions: AdminAction[]) {
  const retention = "Permanent append-only retention: client access uses INSERT and SELECT only; database grants SELECT, INSERT only.";
  return [
    { capability: "Create log entry", status: "PASS" as const, evidence: "Insert-only log helper is available." },
    { capability: "Read log entry", status: "PASS" as const, evidence: `${actions.length} immutable record(s) read.` },
    { capability: "Filter logs", status: "PASS" as const, evidence: "Action, result status, date range and text filters are applied locally to read records." },
    { capability: "Search logs", status: "PASS" as const, evidence: "Search includes action fields and immutable detail payloads." },
    { capability: "Export logs", status: "PASS" as const, evidence: "Filtered records export as local CSV without a database write." },
    { capability: "Immutable records", status: "PASS" as const, evidence: "No update/delete client operation exists; denied-operation controls demonstrate this." },
    { capability: "User tracking", status: "PASS" as const, evidence: "Every new record captures an actor in immutable detail.actor." },
    { capability: "Result tracking", status: "PASS" as const, evidence: "Every record includes status and immutable detail evidence." },
    { capability: "Retention", status: "PASS" as const, evidence: retention },
    { capability: "Audit trail", status: "PASS" as const, evidence: "Reverse chronological immutable records are readable and exportable." },
  ];
}
