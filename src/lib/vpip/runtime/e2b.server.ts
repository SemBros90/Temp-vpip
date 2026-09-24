/**
 * Minimal E2B client over HTTP (control API + in-sandbox envd API).
 * Server-only. Uses fetch so it runs in the edge worker.
 */

const API = "https://api.e2b.dev";
const ENVD_PORT = 49983;

export interface SandboxHandle {
  sandboxId: string;
  domain: string;
  envdToken: string | null;
  trafficToken: string | null;
}

export class E2BError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

function apiKey() {
  const key = process.env["E2B_API_KEY"];
  if (!key) throw new E2BError("E2B_API_KEY is not configured. Add your E2B API key to enable the real runtime.");
  return key;
}

export function hasE2BKey() {
  return !!process.env["E2B_API_KEY"];
}

async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "X-API-KEY": apiKey(), "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const msg = typeof body === "object" && body && "message" in body ? String((body as { message: unknown }).message) : text;
    throw new E2BError(`E2B ${init.method ?? "GET"} ${path} failed (${res.status}): ${msg || res.statusText}`, res.status);
  }
  return body as Record<string, unknown> | null;
}

function toHandle(b: Record<string, unknown> | null): SandboxHandle {
  if (!b || typeof b["sandboxID"] !== "string") throw new E2BError("E2B returned no sandbox id");
  return {
    sandboxId: b["sandboxID"] as string,
    domain: (b["domain"] as string) || "e2b.app",
    envdToken: (b["envdAccessToken"] as string) || null,
    trafficToken: (b["trafficAccessToken"] as string) || null,
  };
}

export async function createSandbox(opts: { timeoutSec: number; metadata: Record<string, string> }) {
  const b = await api("/v2/sandboxes", {
    method: "POST",
    body: JSON.stringify({
      templateID: "base",
      timeout: opts.timeoutSec,
      secure: true,
      autoPause: true,
      metadata: opts.metadata,
      network: { allowPublicTraffic: false, maskRequestHost: "localhost:${PORT}" },
    }),
  });
  return toHandle(b);
}

export async function connectSandbox(sandboxId: string, timeoutSec: number) {
  const b = await api(`/v2/sandboxes/${encodeURIComponent(sandboxId)}/connect`, {
    method: "POST",
    body: JSON.stringify({ timeout: timeoutSec }),
  });
  return toHandle(b);
}

export async function pauseSandbox(sandboxId: string) {
  await api(`/sandboxes/${encodeURIComponent(sandboxId)}/pause`, { method: "POST" });
}

export async function killSandbox(sandboxId: string) {
  try {
    await api(`/sandboxes/${encodeURIComponent(sandboxId)}`, { method: "DELETE" });
  } catch (e) {
    if (e instanceof E2BError && e.status === 404) return;
    throw e;
  }
}

export async function setSandboxTimeout(sandboxId: string, timeoutSec: number) {
  await api(`/sandboxes/${encodeURIComponent(sandboxId)}/timeout`, {
    method: "POST",
    body: JSON.stringify({ timeout: timeoutSec }),
  });
}

/** Returns "running" | "paused" | "gone" */
export async function sandboxState(sandboxId: string): Promise<"running" | "paused" | "gone"> {
  try {
    const b = await api(`/sandboxes/${encodeURIComponent(sandboxId)}`);
    const s = String(b?.["state"] ?? "running");
    return s === "paused" ? "paused" : "running";
  } catch (e) {
    if (e instanceof E2BError && e.status === 404) return "gone";
    throw e;
  }
}

/* ------------------------------------------------------------- envd */

function envdBase(h: SandboxHandle) {
  return `https://${ENVD_PORT}-${h.sandboxId}.${h.domain}`;
}

function envdHeaders(h: SandboxHandle, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = {
    Authorization: `Basic ${btoa("user:")}`,
    ...extra,
  };
  if (h.envdToken) headers["X-Access-Token"] = h.envdToken;
  return headers;
}

/** Upload files (absolute sandbox paths). Parent folders are created by envd. */
export async function writeFiles(h: SandboxHandle, files: Array<{ path: string; data: Uint8Array }>) {
  const form = new FormData();
  for (const f of files) form.append("file", new Blob([f.data as BlobPart]), f.path);
  const res = await fetch(`${envdBase(h)}/files?username=user`, {
    method: "POST",
    headers: envdHeaders(h),
    body: form,
  });
  if (!res.ok) throw new E2BError(`File upload failed (${res.status}): ${await res.text()}`, res.status);
}

export async function readFile(h: SandboxHandle, path: string): Promise<string | null> {
  const res = await fetch(`${envdBase(h)}/files?path=${encodeURIComponent(path)}&username=user`, {
    headers: envdHeaders(h),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new E2BError(`File read failed (${res.status}): ${await res.text()}`, res.status);
  return res.text();
}

function b64ToText(b64: string) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/**
 * Run a short shell command to completion via envd's Connect RPC stream.
 * Long-running work must be backgrounded inside the command itself.
 */
export async function runCommand(h: SandboxHandle, cmd: string, timeoutMs = 45_000) {
  const json = new TextEncoder().encode(
    JSON.stringify({ process: { cmd: "/bin/bash", args: ["-l", "-c", cmd], envs: {}, cwd: "/home/user" } }),
  );
  const frame = new Uint8Array(5 + json.length);
  new DataView(frame.buffer).setUint32(1, json.length);
  frame.set(json, 5);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${envdBase(h)}/process.Process/Start`, {
      method: "POST",
      headers: envdHeaders(h, {
        "Content-Type": "application/connect+json",
        "Connect-Protocol-Version": "1",
        "Keepalive-Ping-Interval": "50",
      }),
      body: frame,
      signal: ctrl.signal,
    });
    if (!res.ok || !res.body) throw new E2BError(`Command failed to start (${res.status}): ${await res.text()}`, res.status);
    const buf = new Uint8Array(await res.arrayBuffer());
    let stdout = "";
    let stderr = "";
    let exitCode: number | null = null;
    let offset = 0;
    while (offset + 5 <= buf.length) {
      const flags = buf[offset]!;
      const len = new DataView(buf.buffer, buf.byteOffset + offset + 1, 4).getUint32(0);
      const payload = new TextDecoder().decode(buf.slice(offset + 5, offset + 5 + len));
      offset += 5 + len;
      if (flags & 0x02) {
        const end = payload ? (JSON.parse(payload) as { error?: { message?: string } }) : {};
        if (end.error) throw new E2BError(`Command stream error: ${end.error.message ?? "unknown"}`);
        continue;
      }
      const msg = JSON.parse(payload) as {
        event?: { data?: { stdout?: string; stderr?: string }; end?: { exitCode?: number; exit_code?: number; error?: string } };
      };
      const ev = msg.event;
      if (ev?.data?.stdout) stdout += b64ToText(ev.data.stdout);
      if (ev?.data?.stderr) stderr += b64ToText(ev.data.stderr);
      if (ev?.end) exitCode = ev.end.exitCode ?? ev.end.exit_code ?? 0;
    }
    return { stdout, stderr, exitCode: exitCode ?? 0 };
  } finally {
    clearTimeout(timer);
  }
}

/** Public host of a port inside the sandbox (only reachable with the traffic token). */
export function portOrigin(h: { sandboxId: string; domain: string }, port: number) {
  return `https://${port}-${h.sandboxId}.${h.domain}`;
}
