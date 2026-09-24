# Repository Compatibility & Safe Repair Upgrade

This builds on the Compatibility Report, Import Diagnostics page and Auto Repair that already exist. Nothing outside repository import, diagnostics and repair changes.

## What the user will see

A new **Safe Repair** area on each project's Import Diagnostics page. It has six tabs:

1. **Ingestion Audit** (Stage 1)
   - Shows Files Found, Imported, Ignored and Failed, plus a list of missing files.
   - Found = every entry in the source repository's tree.
   - All files are kept, including hidden, config, CI, Docker, deployment, infrastructure and custom files.
   - Text files are stored as text. Every other file is stored in base64, so nothing is dropped just because it is binary or unrecognised.
   - If Imported + Ignored does not equal Found, the import fails with the list of lost files, and no project is created.
2. **Classification** (Stage 2)
   - Shows Framework, Package Manager, Build System, Repository Type, Monorepo Status, Deployment Platform and CI/CD Platform.
   - Each value is backed by the file that proves it. For example, Vercel is detected from `vercel.json` and GitHub Actions from `.github/workflows/*`.
   - If there is no evidence, the value shows **Unknown**.
3. **Environment & Dependencies** (Stages 3–4)
   - **Environment:** every `.env*` file is kept exactly as it was. Shows Required, Found (in `.env` files or saved values) and Missing.
   - **Dependencies:** reads package.json and every lockfile type (npm, yarn, pnpm, bun). Shows installed, missing and peer dependencies, version conflicts and overall resolution status.
   - Dependency problems and code problems appear in separate tables.
4. **Preview Readiness** (Stage 5)
   - Shows four integrity scores: Repository, Dependency, Environment and Preview. They are computed before each preview.
   - When the preview fails, each problem is listed with its exact file, dependency, environment variable and error message.
5. **Rollback** (Stage 6)
   - **Rollback Point Zero** is created automatically right after import. It stores the full file snapshot, file tree and repository metadata.
   - You can restore from it any number of times. Each restore is logged. Later snapshots are kept, so history is never lost.
6. **Repair Proposals** (Stages 7–12)
   - **Simulate repair** makes a list of proposed changes and writes nothing. It shows files to change, dependencies to install or remove, and config and environment changes.
   - Each proposal shows:
     - its classification (one of the 10 types)
     - an impact report covering why, the problem solved, files affected, dependency count, and UI, logic, build, deployment, database and security impact, with a plain-language explanation
     - its risk level
     - a confidence score and explanation, with a warning below 70%
     - whether it can be rolled back, and what happens if you apply it
   - Controls: Approve, Reject, file-level approval (tick individual files), and Batch approve.
   - Only approved items are applied. A snapshot is taken first, so every change can be undone.
7. **Audit Log** (Stage 13)
   - Every import, simulation, approval, rejection, apply and restore is recorded.
   - Each entry records the user, time, repository, change type, risk, confidence, files and dependencies.

There is also a new top-level **Validation** page (Stage 14):
- It runs the full pipeline (import, audit, classify, readiness, simulate) against a saved list of test repositories. The list covers React, Vite, Next.js, Remix, a monorepo, a Supabase project, a static site and any GitHub repository URL.
- It reports Import, Preview, Repair and Compatibility success rates. Each run is saved as a report.

## Protection rules (Stage 15)

- The simulator always proposes dependency fixes first.
- It proposes code changes only for problems a dependency or config fix cannot solve.
- It never proposes redesigns or replacement of the app.
- The existing one-click "Auto Repair" is changed to open the Simulate → Approve flow instead of changing files directly.

## Honest limits

- Repair proposals are built from detected problems by fixed rules, not free-form AI rewriting. Confidence scores come from those rules. For example, installing a package = 98% and a stub or code edit = 60–65%.
- "Preview success" in the validation runs means the browser preview mounted without errors. Server-side code still does not run in the preview.
- Very large repositories are limited by the 2 MB-per-file download limit of the git host API. Files over that size are counted as **Ignored (too large)** and named. They are never lost silently.

## Database (additive only)

- `vpip_repo_snapshots`: id, project_id, repository_id, build_session_id, label ("Rollback Point Zero"...), is_zero, files jsonb, tree jsonb, metadata jsonb, created_at
- `vpip_repair_proposals`: id, project_id, repository_id, build_session_id, simulation_id, classification, risk, confidence, confidence_note, problem, fix, impact jsonb, files jsonb, dependencies jsonb, status (Proposed/Approved/Rejected/Applied/Reverted), approved_files jsonb, snapshot_id, created_at, decided_at, decided_by
- `vpip_repair_audit`: id, project_id, repository_id, user, action, change_type, risk, confidence, files jsonb, dependencies jsonb, note, created_at
- `vpip_validation_runs`: id, targets jsonb, results jsonb, metrics jsonb, created_at
- `vpip_repo_reports` gets new columns `ingestion jsonb` and `readiness jsonb`.
- All new tables get grants, row-level security and a project foreign key, following the existing pattern. Nothing is renamed or dropped.

## Technical details

- `github.ts` / `git-remote.ts`: `readBranchFiles` returns every tree entry, stores non-text files as base64 with an `encoding` flag, and returns `{files, found, ignored, failed}`.
- `PullRepositoryDialog` checks the counts before it creates the project, then writes Rollback Point Zero and the first audit entry.
- New `src/lib/vpip/safe-repair.ts`: `classifyExtended`, `envAudit`, `dependencyAudit` (lockfile parsers), `readiness`, `simulateRepair` (pure), `applyApproved`, `restoreSnapshot`.
- Types, `db.ts` mapping and store actions are added for the four new tables. They are included in the delete cascade and in export.
- UI: a `SafeRepairPanel` inside the Import Diagnostics page, and a new route `src/routes/validation.tsx` linked from the sidebar.
