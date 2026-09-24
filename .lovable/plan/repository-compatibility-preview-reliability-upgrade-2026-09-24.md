# Repository Compatibility + Preview Reliability Upgrade

Every imported repository gets a saved Compatibility Report. The report says what the repository is, what is missing, and why the preview works or fails. Common problems get fixed automatically before the preview starts.

## What the user will see

- **Pull repository** (Projects page), which already creates a project on its own, now runs these steps in order: Scan → Create project → Repository record → Compatibility report → Preview.
- **Compatibility tab on the Repositories page**, with:
  - Classification: framework, language, package manager, build system, workspace type
  - Health score: overall %, plus Dependencies / Imports / Assets / Environment / Preview readiness
  - A table for each area:
    - Dependencies: package, required version, locked version, status
    - Imports: file, referenced by, expected path
    - Aliases: every alias found
    - Environment variables: required, configured, missing, with fields to enter values
  - An **Unsupported reasons** list, for example "Docker required (Dockerfile found)", "PostgreSQL required", "Python service required", "Electron runtime required", "Monorepo: previewing app `apps/web`"
  - Buttons: **Re-scan**, **Install missing dependencies**, **Repair & preview**
- **Preview Diagnostics panel in the builder** (a new tab next to Logs), showing the same statuses and the exact file or package behind each error. It also lists runtime errors caught from the preview. The preview never shows only "Preview failed".
- **Discussions, Knowledge Extraction, Prompt Generation and AI Coder** automatically attach a short diagnostics summary to what the AI reads: missing dependencies, imports, assets and settings. A **"Ask AI to fix"** button in the panel sends it to the builder chat.

## An honest limit

The preview runs in the browser. It does not run a real `npm install` or build. So:
- **Install missing dependencies** adds the missing packages to `package.json` and loads them in the preview from a public package source.
- Repositories that need Docker, a database, Python, Electron/Tauri, or a Next.js/Remix/Nuxt server are detected and explained, not run.
- React and Vite apps, and client-only Next.js pages, get the best-effort preview.

## Repair order before preview

1. Add missing dependencies to the preview's package map
2. Resolve aliases (`@`, `~`, `src`, `app`, and custom ones)
3. Clear the cached preview document
4. Re-run validation
5. Launch the preview, with any remaining issues listed in the panel

## Database changes (reported before implementation)

New table **`vpip_repo_reports`** (one row per repository and branch scan, newest shown):
- `id`, `workspace_id`, `project_id` → projects, `repository_id` → repositories, `build_session_id` (nullable), `branch`, `commit_sha`
- `classification` jsonb, `dependencies` jsonb, `imports` jsonb, `aliases` jsonb, `environment` jsonb, `unsupported` jsonb, `preview_diagnostics` jsonb
- `health` jsonb (overall + breakdown), `created_at`
- Indexes on `project_id` and `repository_id`. RLS and grants follow the existing tables.

New table **`vpip_repo_env`** holds the environment values users enter:
- `id`, `workspace_id`, `repository_id`, `key`, `value`, `updated_at`, unique (`repository_id`, `key`)
- RLS: only the workspace owner can read or write. The values are never sent to the AI; only the variable names are.

Additive columns on repositories: `last_push_at timestamptz`, `classification jsonb`.

Nothing is renamed or dropped. Both tables go into the existing full-sync save, verification, export/import and delete cascade.

## Affected screens

Projects page (import dialog), Repositories page (new Compatibility tab), Builder (Diagnostics tab, repair before preview), Discussions / Extraction / Prompts (diagnostics added to what the AI reads).

## Technical details

- New `src/lib/vpip/repo-analyzer.ts`, pure functions over `GhFile[]`:
  - `classify`: deps plus markers such as `nuxt.config`, `svelte.config`, `astro.config`, `electron`, `src-tauri/`, `@nestjs/core`, `express`, `turbo.json`, `nx.json`, workspaces or `pnpm-workspace.yaml`
  - `parseLockfiles`: package-lock v2/v3, pnpm-lock, yarn.lock. `bun.lockb` is binary, so it is reported only as present
  - `readAliases`: tsconfig/jsconfig `paths` (JSONC-tolerant) plus regex over vite/next/webpack `alias`
  - `validateImports`: parses import, require, dynamic import, CSS url and asset imports in every file, then resolves them through extensions, index files and aliases. The report is complete; it does not stop at the first error
  - `scanEnv`: `import.meta.env.X`, `process.env.X`, `.env.example`
  - `detectUnsupported`: Dockerfile / compose, pg/prisma/postgres URLs, `requirements.txt` / `pyproject`, electron / tauri, SSR-only frameworks
  - `healthScore`: weighted breakdown
- `coder-fs.ts`: `buildPreviewDoc` accepts the resolved alias map and extra deps from the report, and adds the env values as `import.meta.env` / `process.env` shims.
- `store.tsx` / `db.ts` / `types.ts`: new `RepoReport` and `RepoEnvVar` types, actions `saveRepoReport` and `setRepoEnv`, plus mapping and sync.
- `context-package.ts` / discussion prompt assembly: a `repoDiagnosticsSummary(report)` is added to what the AI reads.
- The existing `detectFramework` in PullRepositoryDialog is replaced by `classify`.
