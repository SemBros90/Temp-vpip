# Import Compatibility Upgrade — universal repository importer

This builds on the Compatibility Report that already exists. Items 1, 2 (partly), 4, 5, 6 and 11 are already in place. This plan adds what is still missing and stops the preview from running server code.

## What the user will see

- **Import Diagnostics page**: a new page in each project, under Project → Import Diagnostics. It shows:
  1. A verdict: "Preview can run", "Preview can run with stubs" or "Preview cannot run", plus the exact reasons
  2. Counts: total files, dependencies, missing dependencies, missing assets, alias issues, unsupported features, runtime issues, and preview readiness %
  3. A **Must fix** list, where each row gives the file, the problem and the fix (for example, "Run `npm i lucide-react`" or "Set SUPABASE_URL")
  4. How the code splits into Frontend, Backend and Shared, with file counts and a searchable list
  5. Server-only files, each shown with the Node or server features it uses (`fs`, `path`, `req`/`res`, `setHeader`, `process`, `child_process`…)
  6. A dependency graph: which files import which, which packages each file uses, and which files the app's starting file never reaches
  7. Build Health in five stages (Dependency resolution, Import resolution, Compile, Runtime, Preview), each marked Pass, Warn or Fail with details
- **Auto Repair** button, on the new page and in the builder's Diagnostics tab. It works through these steps in order:
  1. Add missing packages
  2. Fix aliases
  3. Swap unsupported or server imports for stubs
  4. Leave backend files out of the preview
  5. Build a preview-safe version
  6. Launch the preview and record whether compile, runtime and preview succeeded
- A missing package never stops an import. It is marked Missing, with an install command you can copy.

## Behaviour changes

- **Assets**: the import now downloads images and fonts up to 2 MB each (png, jpg, jpeg, gif, svg, webp, ico, woff, woff2, ttf, otf). The preview loads them, so `@/assets/logo.png` works. Larger files are listed as "skipped (too large)", not as missing.
- **Backend isolation**: files classed as Backend never run inside the preview. If frontend code imports one, it gets an empty stub and a warning explaining why. Imports of Node built-ins such as `fs`, `path`, `crypto` and `http` become harmless browser stubs.
- **Build Health** is no longer based on file count. It combines the five stages with these weights:
  - Dependencies 25%
  - Imports 25%
  - Compile 20%
  - Runtime 15%
  - Preview 15%

  Compile, runtime and preview scores come from the last real preview attempt. Until a first attempt, they show "Not run yet".
- **Detection** adds remix.config, the tailwind config (its content paths and plugins become required packages), webpack aliases, and full-stack combinations such as "Vite + React + Express". Astro, Express and plain Node repositories are detected and explained.

## Honest limits

- The preview runs in the browser, with no real `npm install`, bundler or server. Next.js and Remix server features, API routes, databases and Docker are replaced with stubs or explained, not run.
- The 90% target is realistic for client-rendered React and Vite repositories, and for Next.js pages that mostly run in the browser. It is not realistic for Next.js apps that rely on server rendering.

## Database

- No new tables. The existing report record gets new fields inside its current data: `graph`, `codeSplit`, `serverOnly`, `assets`.
- One additive column, `vpip_repo_reports.stages jsonb`. Nothing is renamed or dropped.

## Technical details

- `repo-analyzer.ts`:
  - `buildDependencyGraph`: nodes, edges, which files the starting file reaches, and packages per file.
  - `splitCode`: sorts files by path patterns (`server/`, `api/`, `pages/api`, `app/**/route.ts`, `*.server.*`, `functions/`, `backend/`) and by content signals. A file counts as Shared when both sides import it.
  - `detectServerApis`: finds Node built-ins, `node:` imports, `req.`/`res.`, `setHeader`, and any `process.` use other than `process.env.NODE_ENV`.
  - `parseTailwindConfig` and `parseRemixConfig` are new.
  - `healthScore` is rewritten to use the five-stage model.
- `github.ts` / `git-remote.ts`: `readBranchFiles` keeps binary assets of 2 MB or less as base64 data URLs and flags each file's encoding.
- `coder-fs.ts`:
  - `buildPreviewDoc` accepts `excludePaths` and `stubModules`.
  - Asset imports and CSS `url()` are rewritten to data URLs.
  - Node built-ins map to stubs.
  - Compile and runtime errors are reported back so each stage result can be recorded.
- New route `src/routes/projects.$projectId.import-diagnostics.tsx`, linked in the project navigation.
- `RepoCompatibilityPanel`: the repair flow gains the stub and exclude steps and writes `stages`.
- Migration: `ALTER TABLE vpip_repo_reports ADD COLUMN IF NOT EXISTS stages jsonb DEFAULT '{}'`, plus the matching mapping in `db.ts`.
