import { createServerFn } from "@tanstack/react-start";
import { setCookie } from "@tanstack/react-start/server";
import { z } from "zod";
import * as rt from "./runtime.server";

/** VPIP is a single-owner system: no user sign-in. All runtime calls act as the local owner. */
async function caller(): Promise<rt.Caller> {
  return rt.ownerCaller();
}

const rowInput = z.object({ rowId: z.string().min(1).max(64) });

export const runtimeInfo = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ projectId: z.string(), buildId: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const c = await caller();
    const role = await rt.requireProjectAccess(c, data.projectId);
    const row = await rt.activeRowForBuild(data.buildId);
    return { configured: rt.hasE2BKey(), role, row: row && row.project_id === data.projectId ? row : null };
  });

export const runtimeLaunch = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ buildId: z.string() }).parse(d))
  .handler(async ({ data }) => rt.launch(await caller(), data.buildId));

export const runtimeSync = createServerFn({ method: "POST" })
  .inputValidator((d) => rowInput.parse(d))
  .handler(async ({ data }) => rt.syncOnly(await caller(), data.rowId));

export const runtimeInstall = createServerFn({ method: "POST" })
  .inputValidator((d) => rowInput.parse(d))
  .handler(async ({ data }) => rt.installOnly(await caller(), data.rowId));

export const runtimeStart = createServerFn({ method: "POST" })
  .inputValidator((d) => rowInput.parse(d))
  .handler(async ({ data }) => rt.startRuntime(await caller(), data.rowId));

export const runtimeStop = createServerFn({ method: "POST" })
  .inputValidator((d) => rowInput.parse(d))
  .handler(async ({ data }) => rt.stopRuntime(await caller(), data.rowId));

export const runtimePause = createServerFn({ method: "POST" })
  .inputValidator((d) => rowInput.parse(d))
  .handler(async ({ data }) => rt.pauseRuntime(await caller(), data.rowId));

export const runtimeResume = createServerFn({ method: "POST" })
  .inputValidator((d) => rowInput.parse(d))
  .handler(async ({ data }) => rt.resumeRuntime(await caller(), data.rowId));

export const runtimeDestroy = createServerFn({ method: "POST" })
  .inputValidator((d) => rowInput.parse(d))
  .handler(async ({ data }) => rt.destroyRuntime(await caller(), data.rowId));

export const runtimeHeartbeat = createServerFn({ method: "POST" })
  .inputValidator((d) => rowInput.parse(d))
  .handler(async ({ data }) => rt.heartbeat(await caller(), data.rowId));

export const runtimeStatusFn = createServerFn({ method: "POST" })
  .inputValidator((d) => rowInput.parse(d))
  .handler(async ({ data }) => rt.runtimeStatus(await caller(), data.rowId));

/** Issues the preview cookie (owner / authorized users only) and returns the proxied preview path. */
export const runtimePreviewAccess = createServerFn({ method: "POST" })
  .inputValidator((d) => rowInput.parse(d))
  .handler(async ({ data }) => {
    const c = await caller();
    const { row } = await rt.runtimeStatus(c, data.rowId);
    if (!row.preview_slug) throw new Error("Runtime has no preview.");
    const token = await rt.signPreviewToken(row.id, c.userId);
    setCookie(`vpip_rt_${row.id}`, token, {
      path: "/runtime/",
      httpOnly: true,
      secure: true,
      sameSite: "none",
      partitioned: true,
      maxAge: 12 * 3600,
    });
    await rt.audit({ projectId: row.project_id, buildId: row.build_id, rowId: row.id, sandboxId: row.e2b_sandbox_id, userId: c.userId, email: c.email, action: "preview_access", status: "info" });
    return { path: `/runtime/${row.id}-${row.preview_slug}/` };
  });

export const runtimeAudit = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ projectId: z.string(), buildId: z.string().optional() }).parse(d))
  .handler(async ({ data }) => {
    const c = await caller();
    await rt.requireProjectAccess(c, data.projectId);
    let q = c.supabase.from("vpip_runtime_audit").select("*").eq("project_id", data.projectId).order("created_at", { ascending: false }).limit(300);
    if (data.buildId) q = q.eq("build_id", data.buildId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const runtimeMembers = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ projectId: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const c = await caller();
    const role = await rt.requireProjectAccess(c, data.projectId);
    const { data: rows } = await c.supabase.from("vpip_project_members").select("user_id, email, role, created_at").eq("project_id", data.projectId);
    return { role, members: rows ?? [], me: c.userId };
  });

export const runtimeAddMember = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ projectId: z.string(), email: z.string().email().max(255) }).parse(d))
  .handler(async ({ data }) => {
    await rt.addMember(await caller(), data.projectId, data.email);
    return { ok: true };
  });

export const runtimeRemoveMember = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ projectId: z.string(), userId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    await rt.removeMember(await caller(), data.projectId, data.userId);
    return { ok: true };
  });

/** Runtime dashboard: sandboxes of projects the caller can access, plus cost totals. */
export const runtimeDashboard = createServerFn({ method: "POST" })
  .handler(async () => {
    const c = await caller();
    const { data: mems } = await c.supabase.from("vpip_project_members").select("project_id").eq("user_id", c.userId);
    const projectIds = (mems ?? []).map((m) => m.project_id);
    if (projectIds.length) await rt.sweep({ projectIds });
    const { data: rows } = projectIds.length
      ? await c.supabase.from("vpip_runtime_sandboxes").select("*").in("project_id", projectIds).order("created_at", { ascending: false }).limit(500)
      : { data: [] };
    return { configured: rt.hasE2BKey(), rows: rows ?? [] };
  });
