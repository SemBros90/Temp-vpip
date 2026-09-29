# Project Mind — approved safe-import fix

## Original request and authorization

Repository: https://github.com/SemBros90/project-mind.git

The user initially selected: **Review the code: Assess the project and report findings.** Constraint: **There must not be any unauthorised Edit,**.

After the read-only review, the user requested **Import with out loss** and explicitly authorized: **Yes—merge safely (Recommended): Keep existing records unchanged, add new records, validate the file, and report conflicts instead of overwriting them.**

Additional requirement: **i have this on other codding app too, so i must be able to operate on that app too**.

Authorization is limited to this safe-import change and its supporting tests/UI. Do not implement the other review findings without explicit permission.

## Architecture decisions

- Keep the existing React/TypeScript/TanStack Start/Vite app and shared Supabase/Postgres persistence.
- Preserve package.json, lockfiles, environment files, database schema, and the version-1 workspace.json export format.
- Reuse existing database serializers, with a separate insert-only writer for import. Never call full-sync deletes, updates, or settings writes during import.
- Validate all 22 workspace collections and nested build/discussion data before writes. Merge by collection + stable ID, current record wins. Report conflicts without exposing record content/secrets.
- Re-read current database state before import and verify/reload after insertion. Database-side ignoreDuplicates protects concurrent ID collisions. Partial insertion failures are explicitly reported and safely retryable.
- Keep import separate from ordinary save operations; preserve background updates and block navigation/closing accidentally during import.
- Snapshot/read ownership must not change during diagnostic-only size reads.
- Only Settings opts into the compact mobile navigation added to Shell; other routes retain their prior layout.

## Implemented

- New workspace-import schema/merge helpers and insert-only vaultImport persistence path.
- Safe async import provider flow, save/import overlap protection, background-update queue, reload/error handling, and beforeunload protection.
- Settings import button, progress state, validation errors, verified counts, detailed conflicts, repeat-file upload support, and stable test selectors.
- Older omitted optional arrays/defaults no longer trigger false conflicts on re-import.
- Portable regression tests and docs/safe-workspace-import.md.
- Other editor compatibility retained; no automatic remote-copy update or live synchronization was performed.

## Verification

- tests/workspace_import_review.test.ts: 18 passed.
- tests/workspace_import_conflict_probe.ts: assertions passed.
- tests/workspace_import_execution.test.ts: 8 execution scenarios passed using the actual persistence functions with an isolated in-memory database adapter, including all 22 collections, ordinary-save regression, concurrent-ID collision, partial failure/retry, read-back failure, and ownership safety.
- Browser success/conflict/retry/mobile flows tested with test-only intercepted Supabase requests. Final browser check confirmed one new row added and conflicting existing row unchanged byte-for-byte.
- No real user-data writes, AI calls, GitHub mutations, account changes, or migrations were performed.
- Full-project tsc still reports two pre-existing errors: AdminControlStatus.tsx created_at on never; admin-ai.tsx not all code paths return. Out of authorized scope.
- New-module functional lint passed with formatting rule excluded; full formatting cleanup not attempted.
- The temporary preview loads the app, but real database loading was not verified; /api/ai/status uses the original all-in-one app route and the template preview ingress cannot route it to the unused backend. Tests intercept that unrelated request. Do not alter the user's app configuration just for this preview environment.
- No authentication credentials were created or modified.

## Prioritized backlog / next tasks

- P0: No known remaining functional safe-import defect from the isolated tests. Live database verification remains unperformed to avoid unauthorized data writes.
- P1 (requires approval): Other review findings — ordinary cross-client save conflict handling, Admin preparation/approval control bugs, restore-preview discrepancy, and streaming error handling.
- P1 (requires approval): Resolve the two pre-existing TypeScript errors.
- P2 (optional): Conflict preview/resolution workflow and optional pre-import export reminder.
- Next: Ensure the other coding-app copy receives the same source changes before relying on the new protections there. Keep the original import file until results are reviewed; this is not automatic two-way synchronization.

## Follow-up: real preview repaired

User explicitly requested: **correct its preview**.

- Reproduced stopped preview app after restart: supplemental supervisor program had autostart/autorestart disabled. Default template programs point to nonexistent frontend/backend subdirectories in this root-level TanStack repository.
- Enabled autostart/autorestart for the existing root-level app on port 3000.
- Added scripts/preview-api-proxy.mjs: a preview-only streaming bridge from the separately routed API port 8001 to the real TanStack app on 3000, configured entirely through environment variables. No application route, Supabase environment, package, schema, or credentials changed.
- Managed by vpip-import-preview and vpip-api-preview. Configuration saved persistently at /root/.config/vpip-preview/supervisor.conf and linked into /etc/supervisor/conf.d/vpip-import-preview.conf.
- Real publishable-key Supabase read returned 200. Existing Projects and Settings load, safe-import control is enabled, and reload/navigation pass WITHOUT test fixtures or replaced responses. Initial full workspace loading can take longer than six seconds; prior verification ended too early.
- External GET /api/ai/status now returns 200 JSON; nonexistent API route returns 404 instead of 502. No failed requests/HTTP errors after warmup in testing report iteration_3.json. Both preview programs RUNNING.
- These real read-only checks supersede the earlier preview/database-read limitations above. No production import/write, AI call, configuration mutation in the database, or other user-data modification was performed. AI provider availability still depends on existing keys/configuration; it was not exercised.
- Preview: https://dd182498-a6ed-4dee-a4e1-a786f613fd2c.preview.emergentagent.com/