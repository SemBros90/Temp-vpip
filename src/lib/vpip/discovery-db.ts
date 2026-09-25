import { supabase } from "@/integrations/supabase/client";
import type { DAnswer, DKnowledge, DOutput, DQuestion, DSession } from "./discovery";

/** Discovery data access — independent of the main workspace autosave. */

const db = supabase as unknown as { from: (t: string) => any };
export const did = () => `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

async function ok<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}

export const listSessions = (projectId: string) =>
  ok<DSession[]>(db.from("vpip_discovery_sessions").select("*").eq("project_id", projectId).order("created_at", { ascending: false }));

export async function loadSession(id: string) {
  const [session, questions, answers, knowledge, outputs] = await Promise.all([
    ok<DSession>(db.from("vpip_discovery_sessions").select("*").eq("id", id).single()),
    ok<DQuestion[]>(db.from("vpip_discovery_questions").select("*").eq("session_id", id).order("created_at")),
    ok<DAnswer[]>(db.from("vpip_discovery_answers").select("*").eq("session_id", id).order("created_at")),
    ok<DKnowledge[]>(db.from("vpip_discovery_knowledge").select("*").eq("session_id", id).order("created_at")),
    ok<DOutput[]>(db.from("vpip_discovery_outputs").select("*").eq("session_id", id).order("version", { ascending: false })),
  ]);
  return { session, questions, answers, knowledge, outputs };
}

export const insertRows = (table: string, rows: object | object[]) => ok(db.from(table).insert(rows as never));
export const updateRow = (table: string, id: string, patch: object) => ok(db.from(table).update(patch as never).eq("id", id));
export const deleteWhere = (table: string, col: string, val: string) => ok(db.from(table).delete().eq(col, val));

export function audit(projectId: string, sessionId: string | null, event: string, detail: Record<string, unknown> = {}) {
  return insertRows("vpip_discovery_audit", { id: did(), project_id: projectId, session_id: sessionId, actor: "Owner", event, detail });
}

export interface AuditRow {
  id: string;
  project_id: string;
  session_id: string | null;
  actor: string;
  event: string;
  detail: Record<string, unknown>;
  created_at: string;
}
export const listAudit = (projectId: string) =>
  ok<AuditRow[]>(db.from("vpip_discovery_audit").select("*").eq("project_id", projectId).order("created_at", { ascending: false }).limit(5000));
