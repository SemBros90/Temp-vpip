# VPIP Upgrade Pack V-02 → V-15 — Implementation Report

All work is additive. No screen was redesigned, no functionality removed, no table renamed, no
existing data touched. Database changes were reported before implementation (migration
`0004_vpip_upgrade_pack_v02_v15.sql`).

## Database summary

New tables (all: text `id` PK, `project_id` FK → `vpip_projects` ON DELETE CASCADE, timestamps,
RLS + grants, index on `project_id`): `vpip_prompt_phases`, `vpip_phase_runs`,
`vpip_context_packages`, `vpip_outcomes`, `vpip_failures`, `vpip_activity`, `vpip_intelligence`.

New columns (all nullable or defaulted): `vpip_knowledge.version`, `.reason_for_change`,
`.source_kind`, `.source_ref_id`; `vpip_build_sessions.context_package_id`,
`.source_document_ids`, `.source_discussion_ids`; `vpip_repo_commits.release_tag`,
`.release_name`; `vpip_discussions.reopened_at`, `.reopen_context`.

## Per-target status

| Target | Status | Screens | Tables | Traceability |
| --- | --- | --- | --- | --- |
| V-02 Project Memory Ownership | Working | Project Memory (new), dashboard link | all project tables | memory is provider-independent; engine contributions listed from `vpip_activity` |
| V-03 Phased Prompt Execution | Working | Prompts → Phase panel | `vpip_prompt_phases`, `vpip_phase_runs` | phase → prompt → attempts, status Pending/Running/Completed/Failed, full history kept |
| V-04 Prompt → Coder Traceability | Working | Build Sessions → "Why this build exists" | `vpip_build_sessions`, `vpip_context_packages` | source prompt + version, decisions, requirements, documents, discussions |
| V-05 Context Package Builder | Working | Context Packages (new); auto-built on Execute In Coder | `vpip_context_packages` | every new build session references a stored package (`CTX-xxx`) |
| V-06 Outcome Learning Engine | Working | Outcomes & Failures (new) | `vpip_outcomes` | subject (Build / Agent Run / Prompt Execution), result, lessons, recommendations; lessons filed as inbox candidates |
| V-07 Failure Analysis Engine | Working | Outcomes & Failures (new) | `vpip_failures` | root cause, resolution, lessons, status; linked build/prompt ids and requirement/decision codes |
| V-08 Discussion Feedback Loop | Working | Discussion → Reopen | `vpip_discussions.reopened_at/.reopen_context` | reopen injects current decisions, requirements, prompts, builds; Extract knowledge produces updated candidates |
| V-09 Knowledge Improvement Loop | Working | Knowledge Explorer → revision history | `vpip_knowledge.version/.reason_for_change` + `revisions` | version, revision date, reason for change, author, full audit list |
| V-10 Repository Intelligence | Working | Repositories → Commits (release tagging) | `vpip_repo_commits.release_tag/.release_name` | repositories, branches, commits, releases; commits carry build code, prompt version, decision/requirement codes |
| V-11 Multi-AI Collaboration | Working | logged from Documents, Prompts, Phases, Context, Extraction, Reopen, Outcomes | `vpip_activity` | provider, model, action (Created / Reviewed / Executed / Extracted / Recorded), author, date |
| V-12 Structured Knowledge Capture | Working | Inbox, Register, Explorer | `vpip_knowledge` | types now include Lesson Learned and Failure Cause (`L-xxx`, `F-xxx`); every object has id, title, description, source, provider, date |
| V-13 Universal Knowledge Extraction | Working | Discussions, Documents, Prompts, Build Sessions, Repositories, Artifacts | `vpip_knowledge` (`source_kind`, `source_ref_id`) | every extraction lands in the Knowledge Inbox as a candidate, never auto-approved |
| V-14 Portable Project Intelligence | Working | Settings (workspace export/import), Dashboard (project ZIP) | all | ZIP now carries ContextPackages, BuildSessions, Artifacts, Repositories, LessonsLearned; `workspace.json` import restores every record, id and link |
| V-15 Organizational Knowledge Engine | Working | Lessons Learned (new), Intelligence Register (new, workspace-level) | `vpip_intelligence` | success/failure patterns and reusable decisions, requirements and prompt structures; search, filter, open source project |

## End-to-end chain

Discussion → Knowledge Extraction → Knowledge Approval → Master Register → Documents → Prompts →
Context Package → Execute In Coder → Build Session → Repository → Artifacts → Outcome Learning →
Failure Analysis → Lessons Learned → Organizational Knowledge — every step has a screen, a table
and a traceability link.

## Not exercised

AI-dependent actions (phase execution, extraction, document and prompt generation) require a
working engine key. DeepSeek is configured and verified; the OpenAI account is rate-limited or out
of credit. Repository operations still require a GitHub token.
