/**
 * Runtime detection — pure, shared by browser and server.
 * Reads repository files exactly as imported; never modifies them.
 */

export type PackageManager = "pnpm" | "yarn" | "npm";

export interface RuntimeFile {
  path: string;
  content: string;
}

export interface PmDetection {
  manager: PackageManager;
  source: string;
  installCommand: string;
  /** package.json "packageManager" field, e.g. pnpm@9.1.0 (enables corepack) */
  corepackSpec: string | null;
}

export interface NodeDetection {
  /** major ("22") or exact ("20.11.1") */
  version: string;
  source: string;
}

export interface DevDetection {
  ok: boolean;
  script: string | null;
  /** command actually executed in the sandbox */
  command: string | null;
  error: string | null;
}

export interface EnvIssue {
  key: string;
  problem: string;
}

export interface EnvReport {
  required: string[];
  configured: string[];
  missing: string[];
  invalid: EnvIssue[];
  warnings: string[];
  /** keys defined inside the repository's own .env files (left untouched) */
  repoEnvFileKeys: string[];
  /** keys injected into the sandbox from VPIP storage */
  injected: string[];
}

export const RUNTIME_PORT = 5173;
export const DEFAULT_NODE = "22";

const norm = (p: string) => p.replace(/^\/+/, "").replace(/^\.\//, "");

function find(files: RuntimeFile[], name: string) {
  return files.find((f) => norm(f.path) === name);
}

export function readPackageJson(files: RuntimeFile[]): Record<string, unknown> | null {
  const f = find(files, "package.json");
  if (!f) return null;
  try {
    return JSON.parse(f.content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function detectPackageManager(files: RuntimeFile[]): PmDetection {
  const pkg = readPackageJson(files);
  const pmField = typeof pkg?.["packageManager"] === "string" ? (pkg["packageManager"] as string) : null;
  const make = (manager: PackageManager, source: string): PmDetection => ({
    manager,
    source,
    installCommand: `${manager} install`,
    corepackSpec: pmField && pmField.startsWith(`${manager}@`) ? pmField : null,
  });
  if (find(files, "pnpm-lock.yaml")) return make("pnpm", "pnpm-lock.yaml");
  if (find(files, "yarn.lock")) return make("yarn", "yarn.lock");
  if (find(files, "package-lock.json")) return make("npm", "package-lock.json");
  if (pmField) {
    const name = pmField.split("@")[0];
    if (name === "pnpm" || name === "yarn" || name === "npm") return make(name, `package.json packageManager (${pmField})`);
  }
  return make("npm", "no lockfile found — npm");
}

function majorFromRange(range: string): string | null {
  const r = range.trim();
  if (!r) return null;
  const parts = r.split("||").map((s) => s.trim()).filter(Boolean);
  let best: number | null = null;
  for (const part of parts) {
    const m = /(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?/.exec(part);
    if (!m) continue;
    let major = Number(m[1]);
    if (/^>=?/.test(part) && !/</.test(part)) major = Math.max(major, Number(DEFAULT_NODE));
    if (best === null || major > best) best = major;
  }
  return best === null ? null : String(best);
}

function fromVersionFile(raw: string): string | null {
  const v = raw.trim().split(/\s+/)[0]?.replace(/^v/, "") ?? "";
  if (!v) return null;
  if (/^lts\//i.test(v) || v === "node" || v === "stable" || v === "latest") return DEFAULT_NODE;
  if (/^\d+\.\d+\.\d+$/.test(v)) return v;
  const m = /^(\d+)/.exec(v);
  return m ? m[1]! : null;
}

export function detectNodeVersion(files: RuntimeFile[]): NodeDetection {
  const nvm = find(files, ".nvmrc");
  if (nvm) {
    const v = fromVersionFile(nvm.content);
    if (v) return { version: v, source: `.nvmrc (${nvm.content.trim()})` };
  }
  const nv = find(files, ".node-version");
  if (nv) {
    const v = fromVersionFile(nv.content);
    if (v) return { version: v, source: `.node-version (${nv.content.trim()})` };
  }
  const pkg = readPackageJson(files);
  const engines = pkg?.["engines"] as Record<string, string> | undefined;
  if (engines && typeof engines["node"] === "string") {
    const v = majorFromRange(engines["node"]);
    if (v) return { version: v, source: `package.json engines.node (${engines["node"]})` };
  }
  return { version: DEFAULT_NODE, source: "not specified — Node 22 LTS" };
}

export function previewBasePath(rowId: string, slug: string) {
  return `/runtime/${rowId}-${slug}/`;
}

export function detectDevCommand(files: RuntimeFile[], pm: PackageManager, basePath: string): DevDetection {
  const pkg = readPackageJson(files);
  if (!pkg) return { ok: false, script: null, command: null, error: "package.json is missing or is not valid JSON." };
  const scripts = (pkg["scripts"] ?? {}) as Record<string, string>;
  const script = scripts["dev"];
  if (!script) {
    return {
      ok: false,
      script: null,
      command: null,
      error: "package.json has no \"dev\" script. VPIP runs the repository's own dev command and does not invent one.",
    };
  }
  const flags = `--host 0.0.0.0 --port ${RUNTIME_PORT} --strictPort --base ${basePath}`;
  const command = pm === "npm" ? `npm run dev -- ${flags}` : `${pm} run dev ${flags}`;
  return { ok: true, script, command, error: null };
}

const BUILTIN_ENV = new Set(["MODE", "DEV", "PROD", "SSR", "BASE_URL", "NODE_ENV"]);
const TEXT_EXT = /\.(m?[jt]sx?|cjs|vue|svelte|astro|html)$/i;
const VALID_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DEV_ENV_FILES = [".env", ".env.local", ".env.development", ".env.development.local"];

function parseEnvKeys(text: string) {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (m) out.push(m[1]!);
  }
  return out;
}

export function envAuditForRuntime(files: RuntimeFile[], stored: Array<{ key: string; value: string }>): EnvReport {
  const required = new Set<string>();
  for (const f of files) {
    const p = norm(f.path);
    if (p.startsWith("node_modules/") || !TEXT_EXT.test(p) || f.content.startsWith("data:")) continue;
    for (const m of f.content.matchAll(/import\.meta\.env\.([A-Za-z_][A-Za-z0-9_]*)/g)) required.add(m[1]!);
    for (const m of f.content.matchAll(/process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g)) required.add(m[1]!);
    for (const m of f.content.matchAll(/process\.env\[\s*["'`]([A-Za-z_][A-Za-z0-9_]*)["'`]\s*\]/g)) required.add(m[1]!);
  }
  for (const b of BUILTIN_ENV) required.delete(b);

  const repoEnvFileKeys = new Set<string>();
  for (const name of DEV_ENV_FILES) {
    const f = find(files, name);
    if (f) parseEnvKeys(f.content).forEach((k) => repoEnvFileKeys.add(k));
  }

  const invalid: EnvIssue[] = [];
  const injected: string[] = [];
  for (const s of stored) {
    if (!VALID_KEY.test(s.key)) invalid.push({ key: s.key, problem: "Name contains characters that are not allowed in environment variable names." });
    else if (!s.value || !s.value.trim()) invalid.push({ key: s.key, problem: "Value is empty." });
    else if (/[\0\r\n]/.test(s.value)) invalid.push({ key: s.key, problem: "Value contains line breaks or NUL characters." });
    else injected.push(s.key);
  }

  const configured = new Set<string>([...injected, ...repoEnvFileKeys]);
  const missing = [...required].filter((k) => !configured.has(k)).sort();
  const warnings: string[] = [];
  for (const k of required) {
    if (!k.startsWith("VITE_") && configured.has(k)) {
      warnings.push(`${k} is not VITE_-prefixed: Vite only exposes it to browser code if the repository customises envPrefix.`);
    }
  }
  return {
    required: [...required].sort(),
    configured: [...configured].sort(),
    missing,
    invalid,
    warnings,
    repoEnvFileKeys: [...repoEnvFileKeys].sort(),
    injected: injected.sort(),
  };
}

export const FOLDER_MARKER = ".folder";

/** Files that are VPIP-internal markers, not repository content. */
export function isVpipMarker(path: string, content: string) {
  const base = norm(path).split("/").pop();
  return base === FOLDER_MARKER && content === "";
}

/** Estimated E2B cost: 2 vCPU ($0.000014/vCPU/s) + 0.5 GiB RAM ($0.0000045/GiB/s). */
export const COST_PER_HOUR_USD = (2 * 0.000014 + 0.5 * 0.0000045) * 3600;

export const IDLE_PAUSE_SECONDS = 600;
export const IDLE_DESTROY_SECONDS = 24 * 3600;

export type RuntimePhase =
  | "none"
  | "creating"
  | "sandbox_created"
  | "syncing"
  | "synced"
  | "sync_failed"
  | "preparing_node"
  | "installing"
  | "installed"
  | "install_failed"
  | "starting"
  | "running"
  | "runtime_failed"
  | "preview_ready"
  | "stopped"
  | "paused"
  | "destroyed";

export const PHASE_LABEL: Record<RuntimePhase, string> = {
  none: "No sandbox",
  creating: "Creating sandbox",
  sandbox_created: "Sandbox Created",
  syncing: "Syncing repository",
  synced: "Repository synced",
  sync_failed: "Sync failed",
  preparing_node: "Preparing Node.js",
  installing: "Installing Dependencies",
  installed: "Dependencies Installed",
  install_failed: "Install failed",
  starting: "Starting Runtime",
  running: "Runtime Running",
  runtime_failed: "Runtime Failed",
  preview_ready: "Preview Ready",
  stopped: "Runtime stopped",
  paused: "Sandbox paused",
  destroyed: "Sandbox destroyed",
};
