# Import Compatibility Upgrade — universal repository importer

Builds on the existing Compatibility Report. Items 1, 2 (partly), 4, 5, 6 and 11 already exist; this plan adds what is missing and makes the preview avoid running server code.

## What the user will see

- **Import Diagnostics page** (new, per project: Project → Import Diagnostics). It shows, in this order:
  1. A verdict: "Preview can run", "Preview can run with stubs", or "Preview cannot run", with the exact reasons
  2. Numbers: total files, dependencies, missing dependencies, missing assets, alias issues, unsupported features, runtime issues, and preview readiness %
  3. A **Must fix** list. Each row names the file, the problem and the fix (for example "Run `npm i lucide-react`" or "Set SUPABASE_URL")
  4. A code split: Frontend / Backend / Shared, with file counts and a searchable list
  5. Server-only files: each file with the Node or server API it uses (`fs`, `path`, `req`/`res`, `setHeader`, `process`, `child_process`, …)
  6. A dependency graph: which files import which, which packages are used, and which files cannot be reached from the app entry
  7. Build Health: five stages (Dependency resolution, Import resolution, Compile, Runtime, Preview), each shown as Pass, Warn or Fail with details
- **Auto Repair** button (on this page and in the builder's Diagnostics tab). It runs these steps in order: add missing packages → fix aliases → swap unsupported or server imports for stubs → leave backend files out of the preview → build a preview-safe version → launch the preview → record whether compile, runtime and preview succeeded.
- Missing packages never stop an import. They are marked Missing, with an install command to copy.

## Behaviour changes

- **Assets:** during import, images and fonts (png, jpg, jpeg, gif, svg, webp, ico, woff, woff2, ttf, otf) up to 2 MB each are downloaded. The preview loads them, so `@/assets/logo.png` works. Larger files are listed as "skipped (too large)" rather than counted as missing.
- **Backend isolation:** files classed as Backend never run inside the preview. When frontend code imports one, it gets an empty stub, and a warning explains why. Imports of `fs`, `path`, `crypto`, `http` and similar Node modules become harmless browser stubs.
- **Build Health** is no longer based on file count. It combines the five stages: dependencies 25%, imports 25%, compile 20%, runtime 15%, preview 15%. Compile, runtime and preview results come from the last real preview attempt. Before any attempt they show "Not run yet".
- **Detection** adds remix.config, tailwind config (content paths and plugins become required packages), webpack aliases, and full-stack combinations (for example "Vite + React + Express"). Astro, Express and plain Node repositories are detected and explained.

## Honest limits

- The preview runs in the browser, with no real `npm install`, bundler or server. Next.js/Remix server features, API routes, databases and Docker are stubbed or explained, not run.
- The 90% goal is realistic for client-rendered React/Vite repositories and for Next.js pages that mostly run in the browser. It is not realistic for Next.js apps that rely on server rendering.

## Database

- No new tables. The existing report record gets new fields inside its current data columns: `graph`, `codeSplit`, `serverOnly`, `assets`, `stages`.
- One additive column, `vpip_repo_reports.stages jsonb`, so the stage results can be queried. Nothing is renamed or dropped.

## Technical details

- `repo-analyzer.ts`:
  - New `buildDependencyGraph` (nodes, edges, entry reachability, packages per file) and `splitCode` (path heuristics such as `server/`, `api/`, `pages/api`, `app/**/route.ts`, `*.server.*`, `functions/`, `backend/`, plus content signals; shared means imported by both sides)
  - New `detectServerApis` (regex for Node built-ins, `node:` imports, `req.`/`res.`, `setHeader`, `process.` other than `process.env.NODE_ENV`) and `parseTailwindConfig` / `parseRemixConfig`
  - `healthScore` rewritten to the stage model
- `github.ts` / `git-remote.ts`: `readBranchFiles` keeps binary assets of 2 MB or less as base64 data URLs, with an `encoding` flag on the file.
- `coder-fs.ts`:
  - `buildPreviewDoc` accepts `excludePaths` (backend files) and `stubModules`, and turns asset imports and CSS `url()` into data URLs
  - Node built-ins map to stub modules
  - Compile errors and runtime errors are reported back so the stage results can be recorded
- New route `src/routes/projects.$projectId.import-diagnostics.tsx`, linked in the project navigation. The Repair flow in `RepoCompatibilityPanel` gains stub and exclude steps and writes the `stages` field.
- Migration: `ALTER TABLE vpip_repo_reports ADD COLUMN IF NOT EXISTS stages jsonb DEFAULT '{}'`, plus mapping in `db.ts`.
