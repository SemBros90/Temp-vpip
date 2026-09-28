# Safe workspace import

## Using it

1. Open **Settings → Storage** and wait for any current edits to finish saving.
2. Select **Import workspace.json safely**. If you exported a ZIP, extract its `workspace.json` first.
3. Wait for verification. The result lists new records, records already present, and conflicts.
4. Expand **View conflicts** to see the affected record IDs. Existing versions always win; incoming versions remain in the original file.

The importer never replaces the workspace. A conflict on a discussion or build keeps that entire existing record, including its messages, files, and history. Settings, API keys, existing repository credentials, and existing project records are not overwritten. New repository records may contain credentials from the selected file, as in the existing export format; keep exported files private.

Malformed JSON, unsupported workspace versions/collections, duplicate IDs, invalid required/nested fields, and missing parent relationships are rejected before insertion. Version 1 exports can omit older optional collections. Unsupported versions are not silently converted.

Imports are insert-only at the database boundary (`ON CONFLICT DO NOTHING` through the existing Supabase client). A record inserted by another app between validation and insertion also wins over the incoming record. No database migration is required.

If connectivity fails midway, some **new** records may already have been added; existing records were not replaced or deleted. The UI reloads the workspace before allowing further saves, or blocks saves if reloading fails. Retrying the same file will not duplicate IDs. Keep the page open while importing.

## Using another coding app

- The existing repository structure, TanStack/Vite stack, Supabase tables, environment variables, package manifest, lockfiles, and `workspace.json` export format are unchanged.
- The fix uses existing dependencies. It does not depend on the editor used to open this repository.
- The other copy must have these source changes to gain the same safe-import behavior. This task does **not** update that copy automatically or synchronize separate databases.
- Avoid simultaneous ordinary edits in older copies: this change protects the import path, not every pre-existing full-workspace save/concurrency path.

## Regression checks

From the repository root, with its existing dependencies installed:

```sh
node --import tsx tests/workspace_import_review.test.ts
node --import tsx tests/workspace_import_conflict_probe.ts
node --import tsx tests/workspace_import_execution.test.ts
```

The execution suite injects a test-only in-memory database adapter into the real persistence module. It must never contact production services. Temporary test files are generated outside the repository and removed on exit. `tsx` is already present in the repository's dependency lockfile; no manifest changes were made.

Verification: 18 validation/merge checks, one assertion-based optional-default conflict regression, and 8 persistence execution scenarios passed. Browser checks used intercepted test-only Supabase responses to exercise successful import, conflicts, retry, errors, and mobile navigation without writing to the user's database.

Live database behavior was not verified. Full-project TypeScript checking still reports two pre-existing errors outside this change (`AdminControlStatus.tsx` and `admin-ai.tsx`); these were deliberately not edited. Functional lint checks for the new import modules passed with the formatting rule excluded; repository-wide style cleanup is not part of this change.