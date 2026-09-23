# VPIP Upgrade Pack V-02 to V-15

Nothing existing is renamed, removed or redesigned. All changes are additive: new tables, new nullable/defaulted columns, new screens, new actions on existing screens.

## Database impact (report first, as required)

### New tables (all with `project_id` text FK to `vpip_projects` ON DELETE CASCADE, text PK `id`, `created_at`/`updated_at`, RLS open access + grants, index on `project_id`)

1. `vpip_prompt_phases` — V-03. Columns: `prompt_id`, `phase_no` int, `title`, `markdown`, `status` (Pending/Running/Completed/Failed, default Pending), `started_at`, `ended_at`, `output`, `error`, `provider`, `model`, `build_session_id`. Index on `prompt_id`.
2. `vpip_phase_runs` — V-03 history. One row per execution attempt: `phase_id`, `prompt_id`, `attempt` int, `status`, `provider`, `model`, `started_at`, `ended_at`, `output`, `error`.
3. `vpip_context_packages` — V-05. Columns: `code`, `title`, `prompt_id`, `prompt_version`, `markdown`, `counts` jsonb, `decision_ids`/`requirement_ids`/`document_ids`/`discussion_ids` jsonb arrays, `provider`, `model`.
4. `vpip_outcomes` — V-06. Columns: `subject_type` (Build/Agent Run/Prompt Execution), `subject_id`, `subject_label`, `result` (Success/Partial Success/Failure), `notes`, `lessons`, `recommendations`, `provider`, `model`, `author`.
5. `vpip_failures` — V-07. Columns: `subject_type` (Build/Agent/Prompt/Requirement Gap), `subject_id`, `subject_label`, `title`, `root_cause`, `resolution`, `lessons`, `status` (Open/Resolved), plus link arrays `build_ids`, `prompt_ids`, `requirement_codes`, `decision_codes` jsonb.
6. `vpip_activity` — V-11 multi-AI collaboration ledger. Columns: `subject_type`, `subject_id`, `subject_label`, `action` (Created/Reviewed/Implemented/Validated/Executed/Extracted), `provider`, `model`, `author`, `note`.
7. `vpip_intelligence` — V-15 organizational register. Columns: `pattern_type` (Success Pattern/Failure Pattern/Reusable Decision/Reusable Requirement/Reusable Prompt Structure), `title`, `description`, `tags` jsonb, `source_project_id`, `source_project_name`, `source_kind`, `source_id`, `provider`.

### New columns on existing tables

- `vpip_knowledge`: `reason_for_change` text (V-09), `version` int default 1 (V-09), `source_kind` text default 'Discussion' and `source_ref_id` text (V-13, so candidates from documents/prompts/builds/repos/artifacts record their origin). `type` already free text — new values `Lesson Learned` and `Failure Cause` need no DDL (V-12).
- `vpip_build_sessions`: `context_package_id` text (V-05), `source_document_ids` / `source_discussion_ids` jsonb default `[]` (V-04). Existing prompt/decision/requirement fields already cover the rest.
- `vpip_repo_commits`: `release_tag` text, `release_name` text (V-10 releases).
- `vpip_discussions`: `reopened_at` text, `reopen_context` jsonb default `[]` (V-08).

No column is dropped, renamed or retyped; every new column is nullable or defaulted.

### Relations & indexes
FKs: phases → prompts, phase runs → phases, everything else → `vpip_projects`. Indexes on `project_id` for all new tables, plus `vpip_prompt_phases(prompt_id)`, `vpip_phase_runs(phase_id)`, `vpip_outcomes(subject_id)`, `vpip_failures(subject_id)`, `vpip_activity(subject_id)`.

## Affected screens

Existing (additive only):
- Prompts — phase list per prompt, Execute Phase / Execute All, phase status chips, Extract Knowledge.
- Builds & Coder — traceability panel (prompt, version, decisions, requirements, documents, discussions, context package), Record Outcome, Log Failure, Extract Knowledge.
- Discussions — Reopen Discussion (review decisions/requirements/prompts/builds, generate updated candidates).
- Knowledge Inbox / Master Register / Explorer — new types Lesson Learned and Failure Cause, revision history with reason for change.
- Documents, Repositories, Artifacts — Extract Knowledge action.
- Project dashboard — link to Project Memory.

New routes:
- `/projects/$id/memory` — Project Memory Overview (V-02): counts and lists for discussions, decisions, requirements, documents, prompts, build sessions, repositories, artifacts; provider-independent.
- `/projects/$id/context` — Context Package Builder + stored packages (V-05).
- `/projects/$id/outcomes` — outcomes and failure analysis registers (V-06, V-07).
- `/projects/$id/lessons` — Lessons Learned Register (V-15).
- `/intelligence` — cross-project Project Intelligence Register with search, filter, open source project (V-15).

Export/import (V-14) extends the existing ZIP + workspace JSON to cover build sessions, repositories, artifacts, context packages, outcomes, failures, activity and intelligence, restoring ids and links so traceability survives a round trip.

## Technical notes

- Persistence stays behind `src/lib/vpip/db.ts` (`vaultRead`/`vaultWrite` full sync); each new table gets a mapper and a `syncTable` call. New types go in `src/lib/vpip/types.ts`, new actions in `src/lib/vpip/store.tsx`.
- Phase execution and every extraction route through the existing `/api/ai/chat` proxy, so provider keys stay server-side and OpenAI/DeepSeek remain interchangeable.
- Every write to outcomes, failures, phases and extractions also appends a `vpip_activity` row (provider, model, action, date) — that is the V-11 mechanism.
- Delivered with an Implementation Report per target (Working / Partially Working / Not Implemented) covering screens, tables, relations, workflows and traceability links.

## Order of work

1. Migration + regenerate types. 2. Types & store actions & db mappers. 3. Project Memory + Context Package Builder. 4. Phased prompt execution. 5. Build traceability + outcomes + failures. 6. Reopen discussion + knowledge revisions + new knowledge types. 7. Universal Extract Knowledge. 8. Repository intelligence (releases + retrieval). 9. Export/import. 10. Lessons + Intelligence registers. 11. Implementation Report.
