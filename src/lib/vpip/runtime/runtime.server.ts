/**
 * VPIP Coder runtime orchestration (Phase 1). Server-only.
 *
 * Source of truth: the VPIP build session files (database).
 * Sandbox: disposable runtime copy. GitHub never touches the sandbox.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  connectSandbox,
  createSandbox,
  hasE2BKey,
  killSandbox,
  pauseSandbox,
  portOrigin,
  runCommand,
  sandboxState,
  setSandboxTimeout,
  writeFiles,
  type SandboxHandle,
} from "./e2b.server";
import {
  detectDevCommand,
  detectNodeVersion,
  detectPackageManager,
  envAuditForRuntime,
  IDLE_DESTROY_SECONDS,
  IDLE_PAUSE_SECONDS,
  isVpipMarker,
  previewBasePath,
  RUNTIME_PORT,
  type RuntimeFile,
  type RuntimePhase,
} from "./detect";

type Db = SupabaseClient<Database>;
type Row = Database["public"]["Tables"]["vpip_runtime_sandboxes"]["Row"];

export interface Caller {
  userId: string;
  email: string | null;
  supabase: Db;
}

const V = "/home/user/.vpip";
const APP = "/home/user/app";

async function admin(): Promise<Db> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as Db;
}

function randomId(len: number) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

const nowIso = () => new Date().toISOString();

/* ------------------------------------------------------------ security */

/** VPIP is single-owner: every runtime action runs as this local owner identity. */
export const OWNER_ID = "00000000-0000-0000-0000-000000000001";

/** Single-owner mode: the local VPIP owner, acting through the server client. */
export async function ownerCaller(): Promise<Caller> {
  return { userId: OWNER_ID, email: null, supabase: await admin() };
}

/** Confirms the project exists. Single-owner: no per-user access rules. */
export async function requireProjectAccess(c: Caller, projectId: string): Promise<"owner"> {
  const { data: project, error } = await c.supabase.from("vpip_projects").select("id").eq("id", projectId).maybeSingle();
  if (error) throw new Error(`Could not read project: ${error.message}`);
  if (!project) throw new Error("Project not found.");
  return "owner";
}

/** Provider gate: E2B key present AND the provider not disconnected in Runtime Settings. */
export async function e2bReady(): Promise<boolean> {
  if (!hasE2BKey()) return false;
  const db = await admin();
  const { data } = await db.from("vpip_runtime_providers").select("enabled").eq("id", "e2b").maybeSingle();
  return data ? data.enabled : true;
}

/* ------------------------------------------------------------ audit */

export async function audit(a: {
  projectId: string;
  buildId?: string | null;
  rowId?: string | null;
  sandboxId?: string | null;
  userId?: string | null;
  email?: string | null;
  action: string;
  status: "started" | "success" | "failed" | "info";
  durationMs?: number | null;
  error?: string | null;
  detail?: Record<string, unknown>;
}) {
  const db = await admin();
  await db.from("vpip_runtime_audit").insert({
    project_id: a.projectId,
    build_id: a.buildId ?? null,
    sandbox_row_id: a.rowId ?? null,
    e2b_sandbox_id: a.sandboxId ?? null,
    user_id: a.userId ?? null,
    user_email: a.email ?? (a.userId ? null : "system"),
    action: a.action,
    status: a.status,
    duration_ms: a.durationMs ?? null,
    error: a.error ?? null,
    detail: (a.detail ?? {}) as never,
  });
}

/* ------------------------------------------------------------ rows */

async function getRow(rowId: string): Promise<Row> {
  const db = await admin();
  const { data, error } = await db.from("vpip_runtime_sandboxes").select("*").eq("id", rowId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Runtime not found.");
  return data;
}

async function patchRow(rowId: string, patch: Partial<Row>) {
  const db = await admin();
  const { data, error } = await db
    .from("vpip_runtime_sandboxes")
    .update({ ...patch, updated_at: nowIso() })
    .eq("id", rowId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function handleFor(row: Row): Promise<SandboxHandle> {
  if (!row.e2b_sandbox_id) throw new Error("This runtime has no sandbox.");
  const db = await admin();
  const { data } = await db.from("vpip_runtime_secrets").select("*").eq("sandbox_row_id", row.id).maybeSingle();
  return {
    sandboxId: row.e2b_sandbox_id,
    domain: data?.domain ?? "e2b.app",
    envdToken: data?.envd_token ?? null,
    trafficToken: data?.traffic_token ?? null,
  };
}

async function saveSecrets(rowId: string, h: SandboxHandle) {
  const db = await admin();
  await db.from("vpip_runtime_secrets").upsert({
    sandbox_row_id: rowId,
    envd_token: h.envdToken,
    traffic_token: h.trafficToken,
    domain: h.domain,
    updated_at: nowIso(),
  });
}

function closeRunningSegment(row: Row, endAt = Date.now()): Partial<Row> {
  if (!row.running_since) return {};
  const secs = Math.max(0, (endAt - new Date(row.running_since).getTime()) / 1000);
  return { runtime_seconds: Number(row.runtime_seconds) + secs, running_since: null };
}

/* ------------------------------------------------------------ files */

interface LoadedBuild {
  projectId: string;
  buildId: string;
  repositoryId: string | null;
  files: RuntimeFile[];
}

async function loadBuild(c: Caller, buildId: string): Promise<LoadedBuild> {
  const { data, error } = await c.supabase
    .from("vpip_build_sessions")
    .select("id, project_id, repository_id, files")
    .eq("id", buildId)
    .maybeSingle();
  if (error) throw new Error(`Could not read build session: ${error.message}`);
  if (!data) throw new Error("Build session not found.");
  const raw = (Array.isArray(data.files) ? data.files : []) as Array<{ path?: string; content?: string }>;
  const files = raw
    .filter((f) => typeof f.path === "string" && typeof f.content === "string")
    .map((f) => ({ path: f.path!.replace(/^\/+/, ""), content: f.content! }))
    .filter((f) => !isVpipMarker(f.path, f.content));
  return { projectId: data.project_id, buildId: data.id, repositoryId: data.repository_id, files };
}

function toBytes(content: string): Uint8Array {
  const m = /^data:[\w/+.-]+;base64,(.*)$/s.exec(content);
  if (m) {
    const bin = atob(m[1]!);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new TextEncoder().encode(content);
}

async function sha256Hex(bytes: Uint8Array) {
  const d = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function loadEnv(c: Caller, projectId: string, repositoryId: string | null) {
  if (!repositoryId) return [] as Array<{ key: string; value: string }>;
  const { data } = await c.supabase
    .from("vpip_repo_env")
    .select("key, value")
    .eq("project_id", projectId)
    .eq("repository_id", repositoryId);
  return (data ?? []).map((r) => ({ key: r.key, value: r.value ?? "" }));
}

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

const RUN_SH = `#!/usr/bin/env bash
V=${V}
APP=${APP}
source "$V/config.sh"
ev(){ echo "$1 $(date -u +%Y-%m-%dT%H:%M:%SZ) \${2:-0}" >> "$V/phases.log"; }
setup_node(){
  if [ -x "$V/node/bin/node" ]; then export PATH="$V/node/bin:$PATH"; node -v; return 0; fi
  ev preparing_node
  arch=x64; [ "$(uname -m)" = "aarch64" ] && arch=arm64
  case "$NODE_WANT" in
    *.*.*) ver="v$NODE_WANT";;
    *) ver=$(curl -fsSL "https://nodejs.org/dist/latest-v$NODE_WANT.x/SHASUMS256.txt" | grep -o "node-v[0-9.]*-linux-$arch.tar.gz" | head -1 | sed -E 's/node-(v[0-9.]+)-linux.*/\\1/');;
  esac
  if [ -z "$ver" ]; then echo "Could not resolve Node.js $NODE_WANT from nodejs.org" >&2; return 1; fi
  echo "Installing Node.js $ver ($arch)"
  curl -fsSL "https://nodejs.org/dist/$ver/node-$ver-linux-$arch.tar.gz" | tar -xz -C "$V" || return 1
  mv "$V/node-$ver-linux-$arch" "$V/node"
  export PATH="$V/node/bin:$PATH"
  node -v
}
setup_pm(){
  if [ "$PM" = "npm" ]; then npm -v; return 0; fi
  if [ -n "$COREPACK_SPEC" ]; then corepack enable && corepack prepare "$COREPACK_SPEC" --activate || return 1
  else command -v "$PM" >/dev/null 2>&1 || npm install -g "$PM" || return 1; fi
  "$PM" --version
}
do_install(){
  ev installing
  ( setup_node && setup_pm && cd "$APP" && source "$V/env.sh" && echo "> $PM install" && $PM install ) > "$V/install.log" 2>&1
  code=$?
  if [ $code -eq 0 ]; then ev installed 0; else ev install_failed $code; fi
  return $code
}
ensure_swap(){
  # Small sandboxes (~512MB) OOM-kill esbuild during Vite dependency optimisation; add swap once.
  if [ "$(awk '/SwapTotal/{print $2}' /proc/meminfo)" = "0" ]; then
    SUDO=""; [ "$(id -u)" != "0" ] && command -v sudo >/dev/null 2>&1 && SUDO=sudo
    ( $SUDO fallocate -l 1536M /tmp/vpip.swap 2>/dev/null || $SUDO dd if=/dev/zero of=/tmp/vpip.swap bs=1M count=1536 status=none ) && \
      $SUDO chmod 600 /tmp/vpip.swap && $SUDO mkswap /tmp/vpip.swap >/dev/null && $SUDO swapon /tmp/vpip.swap && echo "swap enabled (1.5G)"
  fi
}
do_dev(){
  export PATH="$V/node/bin:$PATH"
  # Keep Vite and esbuild together below the base sandbox's memory ceiling.
  # esbuild is a separate Go process, so limiting Node alone is insufficient.
  export NODE_OPTIONS="--max-old-space-size=192 \${NODE_OPTIONS:-}"
  export GOMEMLIMIT=160MiB GOGC=25 GOMAXPROCS=1
  ensure_swap >> "$V/run.log" 2>&1 || true
  ev starting
  if [ -f "$V/dev.pid" ]; then kill -- -"$(cat "$V/dev.pid")" 2>/dev/null; rm -f "$V/dev.pid"; fi
  cd "$APP" || { ev runtime_failed 1; return 1; }
  source "$V/env.sh"
  echo "> $DEV_CMD" > "$V/dev.log"
  setsid bash -c "$DEV_CMD" >> "$V/dev.log" 2>&1 < /dev/null &
  pid=$!
  echo $pid > "$V/dev.pid"
  for i in $(seq 1 180); do
    if ! kill -0 "$pid" 2>/dev/null; then wait "$pid"; ev runtime_failed $?; rm -f "$V/dev.pid"; return 1; fi
    code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT$BASE_PATH" || true)
    if [ -n "$code" ] && [ "$code" != "000" ] && [ "$code" -lt 500 ]; then
      ev running 0
      ev preview_ready "$code"
      return 0
    fi
    if tail -n 20 "$V/dev.log" 2>/dev/null | grep -qE 'The service was stopped|JavaScript heap out of memory|Killed$'; then
      kill -- -"$pid" 2>/dev/null || true
      ev runtime_failed 137
      rm -f "$V/dev.pid"
      return 1
    fi
    sleep 1
  done
  ev runtime_failed 124
  return 1
}
case "$1" in
  install) do_install;;
  dev) do_dev;;
  all) do_install && do_dev;;
esac
`;

async function writeRuntimeConfig(h: SandboxHandle, row: Row, files: RuntimeFile[], env: Array<{ key: string; value: string }>) {
  const pm = detectPackageManager(files);
  const node = detectNodeVersion(files);
  const base = previewBasePath(row.id, row.preview_slug!);
  const dev = detectDevCommand(files, pm.manager, base);
  const report = envAuditForRuntime(files, env);
  const valid = env.filter((e) => report.injected.includes(e.key));
  const config = [
    `export NODE_WANT=${shq(node.version)}`,
    `export PM=${shq(pm.manager)}`,
    `export COREPACK_SPEC=${shq(pm.corepackSpec ?? "")}`,
    `export DEV_CMD=${shq(dev.command ?? "")}`,
    `export BASE_PATH=${shq(base)}`,
    `export PORT=${RUNTIME_PORT}`,
    `export COREPACK_ENABLE_DOWNLOAD_PROMPT=0`,
    `export CI=1`,
    "",
  ].join("\n");
  const envSh = valid.map((e) => `export ${e.key}=${shq(e.value)}`).join("\n") + "\n";
  const enc = new TextEncoder();
  await writeFiles(h, [
    { path: `${V}/config.sh`, data: enc.encode(config) },
    { path: `${V}/env.sh`, data: enc.encode(envSh) },
    { path: `${V}/run.sh`, data: enc.encode(RUN_SH) },
  ]);
  await patchRow(row.id, {
    package_manager: `${pm.manager} (${pm.source})`,
    node_version: node.version,
    node_source: node.source,
    dev_command: dev.command,
    env_report: report as never,
  });
  return { pm, node, dev, report };
}

/* ------------------------------------------------------------ sync */

export async function syncRepository(c: Caller, row: Row, build: LoadedBuild) {
  const started = Date.now();
  const h = await handleFor(row);
  await patchRow(row.id, { phase: "syncing", sync_status: "syncing" });
  await audit({ projectId: row.project_id, buildId: row.build_id, rowId: row.id, sandboxId: h.sandboxId, userId: c.userId, email: c.email, action: "repository_sync", status: "started", detail: { files: build.files.length } });
  try {
    for (const f of build.files) {
      if (f.path.split("/").includes("..")) throw new Error(`Refusing unsafe path: ${f.path}`);
    }
    const prepared = await Promise.all(
      build.files.map(async (f) => {
        const data = toBytes(f.content);
        return { path: f.path, data, hash: await sha256Hex(data) };
      }),
    );
    const upload = async (list: typeof prepared) => {
      let batch: typeof prepared = [];
      let size = 0;
      const flush = async () => {
        if (!batch.length) return;
        await writeFiles(h, batch.map((b) => ({ path: `${APP}/${b.path}`, data: b.data })));
        batch = [];
        size = 0;
      };
      for (const p of list) {
        batch.push(p);
        size += p.data.length;
        if (batch.length >= 40 || size > 3_000_000) await flush();
      }
      await flush();
    };
    await runCommand(h, `mkdir -p ${APP} ${V}`);
    await upload(prepared);

    const verify = async () => {
      const out = await runCommand(
        h,
        `cd ${APP} && find . -type f -not -path './node_modules/*' -not -path './.git/*' -print0 | xargs -0 -r sha256sum`,
        90_000,
      );
      const map = new Map<string, string>();
      for (const line of out.stdout.split("\n")) {
        const m = /^([0-9a-f]{64})\s+\.\/(.*)$/.exec(line.trim());
        if (m) map.set(m[2]!, m[1]!);
      }
      return map;
    };
    let remote = await verify();
    let missing = prepared.filter((p) => !remote.has(p.path));
    let corrupted = prepared.filter((p) => remote.has(p.path) && remote.get(p.path) !== p.hash);
    if (missing.length || corrupted.length) {
      await upload([...missing, ...corrupted]);
      remote = await verify();
      missing = prepared.filter((p) => !remote.has(p.path));
      corrupted = prepared.filter((p) => remote.has(p.path) && remote.get(p.path) !== p.hash);
    }
    const known = new Set(prepared.map((p) => p.path));
    const extras = [...remote.keys()].filter((p) => !known.has(p));
    if (extras.length) {
      const list = extras.map((p) => shq(p)).join(" ");
      await runCommand(h, `cd ${APP} && rm -f -- ${list}`, 60_000);
    }
    const stats = {
      total: prepared.length,
      uploaded: prepared.length,
      bytes: prepared.reduce((n, p) => n + p.data.length, 0),
      verified: prepared.length - missing.length - corrupted.length,
      removedStale: extras.length,
      durationMs: Date.now() - started,
    };
    const errors = [
      ...missing.map((p) => ({ path: p.path, problem: "missing in sandbox after upload" })),
      ...corrupted.map((p) => ({ path: p.path, problem: "checksum mismatch (corrupted)" })),
    ];
    const ok = errors.length === 0;
    const updated = await patchRow(row.id, {
      phase: ok ? "synced" : "sync_failed",
      sync_status: ok ? "synced" : "failed",
      last_sync_at: nowIso(),
      sync_stats: stats as never,
      sync_errors: errors as never,
      last_error: ok ? null : `${errors.length} file(s) failed to sync`,
    });
    await audit({ projectId: row.project_id, buildId: row.build_id, rowId: row.id, sandboxId: h.sandboxId, userId: c.userId, email: c.email, action: "repository_sync", status: ok ? "success" : "failed", durationMs: stats.durationMs, error: ok ? null : `${errors.length} file(s) missing or corrupted`, detail: { ...stats, errors: errors.slice(0, 50) } });
    return { ok, row: updated };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const updated = await patchRow(row.id, { phase: "sync_failed", sync_status: "failed", last_error: msg, sync_errors: [{ path: "*", problem: msg }] as never });
    await audit({ projectId: row.project_id, buildId: row.build_id, rowId: row.id, sandboxId: h.sandboxId, userId: c.userId, email: c.email, action: "repository_sync", status: "failed", durationMs: Date.now() - started, error: msg });
    return { ok: false, row: updated };
  }
}

/* ------------------------------------------------------------ lifecycle */

export async function activeRowForBuild(buildId: string) {
  const db = await admin();
  const { data } = await db
    .from("vpip_runtime_sandboxes")
    .select("*")
    .eq("build_id", buildId)
    .is("destroyed_at", null)
    .maybeSingle();
  return data;
}

async function createRow(c: Caller, build: LoadedBuild): Promise<Row> {
  if (!(await e2bReady())) throw new Error("Provider Not Configured: E2B key missing or provider disconnected in Runtime Settings.");
  const started = Date.now();
  const rowId = randomId(14);
  const db = await admin();
  const { error: insErr } = await db.from("vpip_runtime_sandboxes").insert({
    id: rowId,
    project_id: build.projectId,
    build_id: build.buildId,
    owner_id: c.userId,
    status: "creating",
    phase: "creating",
    preview_slug: randomId(24),
  });
  if (insErr) throw new Error(`Could not register sandbox: ${insErr.message}`);
  try {
    const h = await createSandbox({
      timeoutSec: IDLE_PAUSE_SECONDS,
      metadata: { vpip_project: build.projectId, vpip_build: build.buildId, vpip_row: rowId },
    });
    await saveSecrets(rowId, h);
    const row = await patchRow(rowId, {
      e2b_sandbox_id: h.sandboxId,
      status: "running",
      phase: "sandbox_created",
      running_since: nowIso(),
      last_active_at: nowIso(),
    });
    await audit({ projectId: build.projectId, buildId: build.buildId, rowId, sandboxId: h.sandboxId, userId: c.userId, email: c.email, action: "sandbox_create", status: "success", durationMs: Date.now() - started });
    return row;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await patchRow(rowId, { status: "failed", phase: "none", last_error: msg, destroyed_at: nowIso() });
    await audit({ projectId: build.projectId, buildId: build.buildId, rowId, userId: c.userId, email: c.email, action: "sandbox_create", status: "failed", durationMs: Date.now() - started, error: msg });
    throw new Error(msg);
  }
}

async function ensureAlive(c: Caller, row: Row): Promise<Row> {
  if (!row.e2b_sandbox_id) throw new Error("Runtime has no sandbox.");
  const state = await sandboxState(row.e2b_sandbox_id);
  if (state === "gone") {
    const updated = await patchRow(row.id, { ...closeRunningSegment(row), status: "destroyed", phase: "destroyed", destroyed_at: nowIso(), last_error: "Sandbox no longer exists at E2B (expired)." });
    await audit({ projectId: row.project_id, buildId: row.build_id, rowId: row.id, sandboxId: row.e2b_sandbox_id, action: "sandbox_expired", status: "info" });
    void updated;
    throw new Error("The sandbox expired. Launch again to create a new one.");
  }
  if (state === "paused") return resume(c, row);
  return row;
}

async function startBackground(h: SandboxHandle, mode: "all" | "install" | "dev") {
  await runCommand(h, `chmod +x ${V}/run.sh && (setsid nohup bash ${V}/run.sh ${mode} > ${V}/run.log 2>&1 < /dev/null &) ; echo started`);
}

function previewUrls(row: Row, h: SandboxHandle) {
  const base = previewBasePath(row.id, row.preview_slug ?? "");
  return {
    devServerUrl: `${portOrigin(h, row.port)}${base}`,
    previewUrl: base,
  };
}

async function tunnelHealth(row: Row, h: SandboxHandle) {
  const urls = previewUrls(row, h);
  try {
    const headers = new Headers();
    if (h.trafficToken) headers.set("e2b-traffic-access-token", h.trafficToken);
    const res = await fetch(urls.devServerUrl, {
      method: "HEAD",
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(4_000),
    });
    return { ...urls, reachable: res.status > 0 && res.status < 500, httpCode: res.status };
  } catch {
    return { ...urls, reachable: false, httpCode: 0 };
  }
}

async function rotatePreview(row: Row) {
  return patchRow(row.id, { preview_slug: randomId(24) });
}

/** Pull → Sync → Install → Start → Preview (install/start run in the sandbox). */
export async function launch(c: Caller, buildId: string) {
  const build = await loadBuild(c, buildId);
  await requireProjectAccess(c, build.projectId);
  if (!build.files.some((f) => f.path === "package.json")) throw new Error("This build has no package.json at its root; there is nothing to install or run.");
  let row = await activeRowForBuild(buildId);
  row = row ? await ensureAlive(c, row) : await createRow(c, build);
  const synced = await syncRepository(c, row, build);
  if (!synced.ok) return synced.row;
  row = synced.row;
  const h = await handleFor(row);
  const env = await loadEnv(c, build.projectId, build.repositoryId);
  const cfg = await writeRuntimeConfig(h, row, build.files, env);
  if (!cfg.dev.ok) {
    const r = await patchRow(row.id, { phase: "runtime_failed", last_error: cfg.dev.error });
    await audit({ projectId: row.project_id, buildId, rowId: row.id, sandboxId: h.sandboxId, userId: c.userId, email: c.email, action: "runtime_startup", status: "failed", error: cfg.dev.error });
    return r;
  }
  await runCommand(h, `rm -f ${V}/phases.log ${V}/install.log ${V}/dev.log`);
  await startBackground(h, "all");
  await audit({ projectId: row.project_id, buildId, rowId: row.id, sandboxId: h.sandboxId, userId: c.userId, email: c.email, action: "dependency_install", status: "started", detail: { manager: cfg.pm.manager, source: cfg.pm.source, node: cfg.node.version, nodeSource: cfg.node.source, envMissing: cfg.report.missing, envInvalid: cfg.report.invalid } });
  return patchRow(row.id, { phase: "installing", status: "running", phase_events_seen: 0, phase_events: [] as never, last_error: null, last_active_at: nowIso() });
}

async function rowForCaller(c: Caller, rowId: string) {
  const row = await getRow(rowId);
  await requireProjectAccess(c, row.project_id);
  return row;
}

export async function syncOnly(c: Caller, rowId: string) {
  let row = await rowForCaller(c, rowId);
  row = await ensureAlive(c, row);
  const build = await loadBuild(c, row.build_id);
  return (await syncRepository(c, row, build)).row;
}

export async function installOnly(c: Caller, rowId: string) {
  let row = await rowForCaller(c, rowId);
  row = await ensureAlive(c, row);
  const build = await loadBuild(c, row.build_id);
  const h = await handleFor(row);
  const cfg = await writeRuntimeConfig(h, row, build.files, await loadEnv(c, build.projectId, build.repositoryId));
  await runCommand(h, `rm -f ${V}/phases.log`);
  await startBackground(h, "install");
  await audit({ projectId: row.project_id, buildId: row.build_id, rowId, sandboxId: h.sandboxId, userId: c.userId, email: c.email, action: "dependency_install", status: "started", detail: { manager: cfg.pm.manager } });
  return patchRow(rowId, { phase: "installing", phase_events_seen: 0, phase_events: [] as never, last_active_at: nowIso() });
}

export async function startRuntime(c: Caller, rowId: string) {
  let row = await rowForCaller(c, rowId);
  row = await ensureAlive(c, row);
  row = await rotatePreview(row);
  const build = await loadBuild(c, row.build_id);
  const h = await handleFor(row);
  const cfg = await writeRuntimeConfig(h, row, build.files, await loadEnv(c, build.projectId, build.repositoryId));
  if (!cfg.dev.ok) {
    await audit({ projectId: row.project_id, buildId: row.build_id, rowId, sandboxId: h.sandboxId, userId: c.userId, email: c.email, action: "runtime_startup", status: "failed", error: cfg.dev.error });
    return patchRow(rowId, { phase: "runtime_failed", last_error: cfg.dev.error });
  }
  await runCommand(h, `rm -f ${V}/phases.log`);
  await startBackground(h, "dev");
  await audit({ projectId: row.project_id, buildId: row.build_id, rowId, sandboxId: h.sandboxId, userId: c.userId, email: c.email, action: "sandbox_start", status: "started", detail: { command: cfg.dev.command, ...previewUrls(row, h), previewRegenerated: true } });
  return patchRow(rowId, { phase: "starting", phase_events_seen: 0, phase_events: [] as never, last_error: null, last_active_at: nowIso() });
}

export async function stopRuntime(c: Caller, rowId: string) {
  const started = Date.now();
  let row = await rowForCaller(c, rowId);
  row = await ensureAlive(c, row);
  const h = await handleFor(row);
  await runCommand(h, `if [ -f ${V}/dev.pid ]; then kill -- -"$(cat ${V}/dev.pid)" 2>/dev/null; rm -f ${V}/dev.pid; fi; echo "stopped $(date -u +%Y-%m-%dT%H:%M:%SZ) 0" >> ${V}/phases.log`);
  await audit({ projectId: row.project_id, buildId: row.build_id, rowId, sandboxId: h.sandboxId, userId: c.userId, email: c.email, action: "sandbox_stop", status: "success", durationMs: Date.now() - started });
  const r = await getRow(rowId);
  return patchRow(rowId, { phase: "stopped", phase_events_seen: r.phase_events_seen + 1 });
}

export async function pauseRuntime(c: Caller, rowId: string) {
  const started = Date.now();
  const row = await rowForCaller(c, rowId);
  if (!row.e2b_sandbox_id) throw new Error("No sandbox.");
  try {
    await pauseSandbox(row.e2b_sandbox_id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await audit({ projectId: row.project_id, buildId: row.build_id, rowId, sandboxId: row.e2b_sandbox_id, userId: c.userId, email: c.email, action: "sandbox_pause", status: "failed", error: msg });
    throw e;
  }
  await audit({ projectId: row.project_id, buildId: row.build_id, rowId, sandboxId: row.e2b_sandbox_id, userId: c.userId, email: c.email, action: "sandbox_pause", status: "success", durationMs: Date.now() - started });
  return patchRow(rowId, { ...closeRunningSegment(row), status: "paused", phase: "paused" });
}

export async function resume(c: Caller, row: Row) {
  const started = Date.now();
  if (!row.e2b_sandbox_id) throw new Error("No sandbox.");
  let h: SandboxHandle;
  try {
    h = await connectSandbox(row.e2b_sandbox_id, IDLE_PAUSE_SECONDS);
    await saveSecrets(row.id, h);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await audit({ projectId: row.project_id, buildId: row.build_id, rowId: row.id, sandboxId: row.e2b_sandbox_id, userId: c.userId, email: c.email, action: "sandbox_resume", status: "failed", error: msg });
    throw e;
  }
  await audit({ projectId: row.project_id, buildId: row.build_id, rowId: row.id, sandboxId: row.e2b_sandbox_id, userId: c.userId, email: c.email, action: "sandbox_resume", status: "success", durationMs: Date.now() - started });
  const events = Array.isArray(row.phase_events) ? (row.phase_events as Array<{ phase: string }>) : [];
  const last = [...events].reverse().find((e) => e.phase !== "stopped")?.phase ?? "sandbox_created";

  // Dev server recovery: only when the app was installed and had been started (not explicitly stopped).
  const wasStarted = ["starting", "running", "preview_ready", "runtime_failed"].includes(last);
  const explicitlyStopped = events.length > 0 && events[events.length - 1]?.phase === "stopped";
  if (wasStarted && !explicitlyStopped) {
    try {
      const probe = await runCommand(
        h,
        `source ${V}/env.sh 2>/dev/null; alive=no; if [ -f ${V}/dev.pid ] && kill -0 "$(cat ${V}/dev.pid)" 2>/dev/null; then alive=yes; fi; ` +
          `code=$(curl -s -m 1 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT$BASE_PATH" || true); code=\${code:-000}; ` +
          `mods=no; [ -d ${APP}/node_modules ] && mods=yes; echo "$alive $code $mods"`,
        8_000,
      );
      const [alive = "no", code = "000", mods = "no"] = probe.stdout.trim().split(/\s+/).slice(-3);
      const localHealthy = alive === "yes" && code !== "000" && Number(code) < 500;
      const external = localHealthy ? await tunnelHealth(row, h) : { ...previewUrls(row, h), reachable: false, httpCode: 0 };
      const healthy = localHealthy && external.reachable;
      await audit({
        projectId: row.project_id,
        buildId: row.build_id,
        rowId: row.id,
        sandboxId: row.e2b_sandbox_id,
        userId: c.userId,
        email: c.email,
        action: "preview_health",
        status: healthy ? "success" : "failed",
        error: healthy ? null : `Preview health failed (local ${code}, tunnel ${external.httpCode || "unreachable"}).`,
        detail: { sandboxAlive: true, processAlive: alive === "yes", previewReachable: external.reachable, localHttpCode: Number(code) || 0, previewHttpCode: external.httpCode, devServerUrl: external.devServerUrl, previewUrl: external.previewUrl },
      });
      if (!healthy && mods === "yes") {
        row = await rotatePreview(row);
        const build = await loadBuild(c, row.build_id);
        await writeRuntimeConfig(h, row, build.files, await loadEnv(c, build.projectId, build.repositoryId));
        await runCommand(h, `rm -f ${V}/phases.log`);
        await startBackground(h, "dev");
        await audit({ projectId: row.project_id, buildId: row.build_id, rowId: row.id, sandboxId: row.e2b_sandbox_id, userId: c.userId, email: c.email, action: "preview_recovery", status: "started", detail: { reason: "resume_recovery", processAlive: alive === "yes", localHttpCode: Number(code) || 0, previousPreviewHttpCode: external.httpCode, command: row.dev_command, ...previewUrls(row, h), previewRegenerated: true } });
        return patchRow(row.id, { status: "running", phase: "starting", phase_events_seen: 0, phase_events: [] as never, last_error: null, running_since: nowIso(), last_active_at: nowIso() });
      }
      if (!healthy) {
        await audit({ projectId: row.project_id, buildId: row.build_id, rowId: row.id, sandboxId: row.e2b_sandbox_id, userId: c.userId, email: c.email, action: "sandbox_start", status: "failed", error: "Dev server not running after resume and dependencies are missing; use Launch to reinstall." });
      }
    } catch (e) {
      await audit({ projectId: row.project_id, buildId: row.build_id, rowId: row.id, sandboxId: row.e2b_sandbox_id, userId: c.userId, email: c.email, action: "sandbox_start", status: "failed", error: `Resume health check failed: ${e instanceof Error ? e.message : String(e)}` });
    }
  }
  return patchRow(row.id, { status: "running", phase: last, running_since: nowIso(), last_active_at: nowIso() });
}

export async function resumeRuntime(c: Caller, rowId: string) {
  const row = await rowForCaller(c, rowId);
  return resume(c, row);
}

export async function destroyRuntime(c: Caller | null, rowId: string, reason = "sandbox_destroy") {
  const started = Date.now();
  const row = c ? await rowForCaller(c, rowId) : await getRow(rowId);
  if (row.e2b_sandbox_id) {
    try {
      await killSandbox(row.e2b_sandbox_id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await audit({ projectId: row.project_id, buildId: row.build_id, rowId, sandboxId: row.e2b_sandbox_id, userId: c?.userId ?? null, email: c?.email ?? null, action: reason, status: "failed", error: msg });
      throw e;
    }
  }
  await audit({ projectId: row.project_id, buildId: row.build_id, rowId, sandboxId: row.e2b_sandbox_id, userId: c?.userId ?? null, email: c?.email ?? null, action: reason, status: "success", durationMs: Date.now() - started });
  return patchRow(rowId, { ...closeRunningSegment(row), status: "destroyed", phase: "destroyed", destroyed_at: nowIso() });
}

export async function heartbeat(c: Caller, rowId: string) {
  const row = await rowForCaller(c, rowId);
  if (row.status !== "running" || !row.e2b_sandbox_id) return row;
  try {
    await setSandboxTimeout(row.e2b_sandbox_id, IDLE_PAUSE_SECONDS);
  } catch {
    /* sandbox may have auto-paused; status polling reconciles */
  }
  return patchRow(rowId, { last_active_at: nowIso() });
}

/* ------------------------------------------------------------ status */

const AUDIT_FOR_PHASE: Record<string, { action: string; status: "success" | "failed" | "started" | "info"; from?: string }> = {
  preparing_node: { action: "node_setup", status: "started" },
  installed: { action: "dependency_install", status: "success", from: "installing" },
  install_failed: { action: "dependency_install", status: "failed", from: "installing" },
  running: { action: "runtime_startup", status: "success", from: "starting" },
  runtime_failed: { action: "runtime_failure", status: "failed", from: "starting" },
  preview_ready: { action: "preview_create", status: "success", from: "starting" },
};

export async function runtimeStatus(c: Caller, rowId: string) {
  let row = await rowForCaller(c, rowId);
  const logs = { install: "", dev: "", run: "" };
  let devAlive = false;
  let health = { sandboxAlive: false, processAlive: false, previewReachable: false, localHttpCode: 0, previewHttpCode: 0, devServerUrl: null as string | null, previewUrl: null as string | null };
  if (row.status === "running" && row.e2b_sandbox_id) {
    const st = await sandboxState(row.e2b_sandbox_id).catch(() => "running" as const);
    if (st === "gone") {
      row = await patchRow(rowId, { ...closeRunningSegment(row), status: "destroyed", phase: "destroyed", destroyed_at: nowIso(), last_error: "Sandbox no longer exists at E2B (expired)." });
      await audit({ projectId: row.project_id, buildId: row.build_id, rowId, sandboxId: row.e2b_sandbox_id, action: "sandbox_expired", status: "info" });
    } else if (st === "paused") {
      const end = Math.min(Date.now(), new Date(row.last_active_at).getTime() + IDLE_PAUSE_SECONDS * 1000);
      row = await patchRow(rowId, { ...closeRunningSegment(row, end), status: "paused", phase: "paused" });
      await audit({ projectId: row.project_id, buildId: row.build_id, rowId, sandboxId: row.e2b_sandbox_id, action: "sandbox_auto_pause", status: "success", detail: { idleSeconds: IDLE_PAUSE_SECONDS } });
    } else {
      const h = await handleFor(row);
      const SEP = "---VPIP-SEP---";
      const out = await runCommand(
        h,
        `cat ${V}/phases.log 2>/dev/null; echo ${SEP}; tail -c 12000 ${V}/install.log 2>/dev/null; echo ${SEP}; tail -c 12000 ${V}/dev.log 2>/dev/null; echo ${SEP}; tail -c 3000 ${V}/run.log 2>/dev/null; echo ${SEP}; ` +
          `if [ -f ${V}/dev.pid ] && kill -0 "$(cat ${V}/dev.pid)" 2>/dev/null; then proc=alive; else proc=dead; fi; ` +
          `source ${V}/env.sh 2>/dev/null; code=$(curl -s -m 1 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT$BASE_PATH" || true); echo "$proc \${code:-000}"`,
      );
      const [phasesTxt = "", install = "", dev = "", run = "", processStatus = ""] = out.stdout.split(SEP);
      logs.install = install.trim();
      logs.dev = dev.trim();
      logs.run = run.trim();
      const [proc = "dead", localCode = "000"] = processStatus.trim().split(/\s+/);
      devAlive = proc === "alive";
      health = { ...health, sandboxAlive: true, processAlive: devAlive, localHttpCode: Number(localCode) || 0, ...previewUrls(row, h) };
      const lines = phasesTxt.split("\n").map((l) => l.trim()).filter(Boolean);
      const events = lines.map((l) => {
        const [phase = "", at = "", code = "0"] = l.split(" ");
        return { phase, at, code: Number(code) };
      });
      const fresh = events.slice(row.phase_events_seen);
      let phase = row.phase as RuntimePhase;
      for (const ev of fresh) {
        phase = ev.phase as RuntimePhase;
        const map = AUDIT_FOR_PHASE[ev.phase];
        if (map) {
          const from = map.from ? [...events].reverse().find((e) => e.phase === map.from) : undefined;
          const durationMs = from ? new Date(ev.at).getTime() - new Date(from.at).getTime() : null;
          const errorText =
            map.status === "failed"
              ? ev.phase === "install_failed"
                ? `Install exited with code ${ev.code}: ${logs.install.split("\n").slice(-6).join(" | ")}`
                : `Runtime failed (code ${ev.code}): ${logs.dev.split("\n").slice(-6).join(" | ")}`
              : null;
          await audit({
            projectId: row.project_id,
            buildId: row.build_id,
            rowId,
            sandboxId: row.e2b_sandbox_id,
            userId: c.userId,
            email: c.email,
            action: map.action,
            status: map.status,
            durationMs,
            error: errorText,
            detail: { exitCode: ev.code, at: ev.at, ...(ev.phase === "preview_ready" ? previewUrls(row, h) : {}) },
          });
        }
      }
      if (phase === "preview_ready" && !devAlive) phase = "runtime_failed";
      if (phase === "preview_ready" && devAlive) {
        const external = await tunnelHealth(row, h);
        health.previewReachable = external.reachable;
        health.previewHttpCode = external.httpCode;
        if (!external.reachable) phase = "runtime_failed";
      }
      const lastError =
        phase === "install_failed"
          ? logs.install.split("\n").slice(-12).join("\n")
          : phase === "runtime_failed"
            ? health.processAlive && !health.previewReachable
              ? `Preview tunnel is not reachable (HTTP ${health.previewHttpCode || "no response"}). Resume or restart the app to regenerate it.`
              : logs.dev.split("\n").slice(-12).join("\n") || "Dev server exited."
            : null;
      if (fresh.length || phase !== row.phase) {
        row = await patchRow(rowId, {
          phase,
          phase_events_seen: events.length,
          phase_events: events as never,
          last_error: lastError ?? row.last_error,
        });
      }
    }
  }
  return { row, logs, devAlive, health };
}

/* ------------------------------------------------------------ sweep */

export async function sweep(filter?: { projectIds?: string[] }) {
  const db = await admin();
  let q = db.from("vpip_runtime_sandboxes").select("*").is("destroyed_at", null);
  if (filter?.projectIds) q = q.in("project_id", filter.projectIds);
  const { data } = await q;
  const nowMs = Date.now();
  let destroyed = 0;
  let paused = 0;
  for (const row of data ?? []) {
    const idle = (nowMs - new Date(row.last_active_at).getTime()) / 1000;
    try {
      if (idle > IDLE_DESTROY_SECONDS) {
        await destroyRuntime(null, row.id, "sandbox_auto_destroy");
        destroyed++;
      } else if (row.status === "running" && idle > IDLE_PAUSE_SECONDS && row.e2b_sandbox_id) {
        const st = await sandboxState(row.e2b_sandbox_id);
        if (st === "paused") {
          const end = new Date(row.last_active_at).getTime() + IDLE_PAUSE_SECONDS * 1000;
          await patchRow(row.id, { ...closeRunningSegment(row, end), status: "paused", phase: "paused" });
          await audit({ projectId: row.project_id, buildId: row.build_id, rowId: row.id, sandboxId: row.e2b_sandbox_id, action: "sandbox_auto_pause", status: "success" });
          paused++;
        } else if (st === "gone") {
          await patchRow(row.id, { ...closeRunningSegment(row), status: "destroyed", phase: "destroyed", destroyed_at: nowIso() });
          await audit({ projectId: row.project_id, buildId: row.build_id, rowId: row.id, sandboxId: row.e2b_sandbox_id, action: "sandbox_expired", status: "info" });
        }
      }
    } catch (e) {
      console.error("runtime sweep", row.id, e);
    }
  }
  return { checked: data?.length ?? 0, destroyed, paused };
}

/* ------------------------------------------------------------ preview access */

async function hmac(data: string) {
  const secret = process.env["RUNTIME_PREVIEW_SECRET"];
  if (!secret) throw new Error("RUNTIME_PREVIEW_SECRET missing");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function signPreviewToken(rowId: string, userId: string, ttlSec = 12 * 3600) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  return `${userId}.${exp}.${await hmac(`${rowId}.${userId}.${exp}`)}`;
}

export async function verifyPreviewToken(rowId: string, token: string | undefined | null) {
  if (!token) return null;
  const [userId, expStr, sig] = token.split(".");
  if (!userId || !expStr || !sig) return null;
  if (Number(expStr) < Date.now() / 1000) return null;
  const expected = await hmac(`${rowId}.${userId}.${expStr}`);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0 ? userId : null;
}

export async function previewTarget(rowId: string, slug: string) {
  const db = await admin();
  const { data: row } = await db
    .from("vpip_runtime_sandboxes")
    .select("id, project_id, e2b_sandbox_id, preview_slug, port, status, destroyed_at")
    .eq("id", rowId)
    .maybeSingle();
  if (!row || row.destroyed_at || !row.e2b_sandbox_id || !row.preview_slug) return null;
  if (row.preview_slug.length !== slug.length) return null;
  let diff = 0;
  for (let i = 0; i < slug.length; i++) diff |= slug.charCodeAt(i) ^ row.preview_slug.charCodeAt(i);
  if (diff !== 0) return null;
  const { data: sec } = await db.from("vpip_runtime_secrets").select("*").eq("sandbox_row_id", rowId).maybeSingle();
  return {
    projectId: row.project_id,
    sandboxId: row.e2b_sandbox_id,
    domain: sec?.domain ?? "e2b.app",
    trafficToken: sec?.traffic_token ?? null,
    port: row.port,
    status: row.status,
  };
}

export async function touchActive(rowId: string) {
  const db = await admin();
  await db.from("vpip_runtime_sandboxes").update({ last_active_at: nowIso() }).eq("id", rowId);
}

export { hasE2BKey };

/* ------------------------------------------------------------ validation readiness (read-only, never runs) */

export type ReadinessState = "ready" | "warning" | "blocked" | "pending";
export interface ReadinessStage { stage: string; state: ReadinessState; detail: string }

export async function readiness(c: Caller, buildId: string): Promise<{ projectId: string; buildId: string; ready: boolean; stages: ReadinessStage[] }> {
  const build = await loadBuild(c, buildId);
  const providerOk = await e2bReady();
  const pkgOk = build.files.some((f) => f.path === "package.json");
  const pm = detectPackageManager(build.files);
  const node = detectNodeVersion(build.files);
  const dev = detectDevCommand(build.files, pm.manager, "/");
  const env = envAuditForRuntime(build.files, await loadEnv(c, build.projectId, build.repositoryId));
  const active = await activeRowForBuild(buildId);
  const lock = build.files.some((f) => /^(pnpm-lock\.yaml|yarn\.lock|package-lock\.json)$/.test(f.path));
  const S = (stage: string, state: ReadinessState, detail: string): ReadinessStage => ({ stage, state, detail });
  const stages: ReadinessStage[] = [
    S("Provider", providerOk ? "ready" : "blocked", providerOk ? "E2B configured and connected." : "Provider Not Configured (Runtime Settings → Runtime Provider)."),
    S("Pull", build.repositoryId ? "ready" : "warning", build.repositoryId ? "Build session linked to a repository." : "No linked repository — build session files are used as-is."),
    S("Sync", build.files.length ? "ready" : "blocked", `${build.files.length} file(s) in the VPIP master copy.`),
    S("Integrity Check", build.files.length ? "ready" : "blocked", "SHA-256 per file is compared after upload."),
    S("Install", pkgOk ? (lock ? "ready" : "warning") : "blocked", pkgOk ? `${pm.manager} (${pm.source})${lock ? "" : " — no lockfile"}` : "package.json missing."),
    S("Run", dev.ok ? "ready" : "blocked", dev.ok ? `Node ${node.version} · ${dev.script}` : dev.error ?? "No dev script."),
    S("Environment", env.missing.length || env.invalid.length ? "warning" : "ready", env.missing.length ? `Missing: ${env.missing.join(", ")}` : env.invalid.length ? `Invalid: ${env.invalid.map((i) => i.key).join(", ")}` : `${env.configured.length} configured.`),
    S("Preview", providerOk && dev.ok ? "pending" : "blocked", "Served only through the VPIP relay."),
    S("Pause", "pending", active ? "Runtime live — available from the Runtime panel." : "Available once running."),
    S("Resume", "pending", "Available once paused."),
    S("Destroy", "pending", "Available for any live runtime."),
  ];
  return { projectId: build.projectId, buildId, ready: !stages.some((s) => s.state === "blocked"), stages };
}
