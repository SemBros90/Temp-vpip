# Roadmap

- [x] Persistence repair: build sessions, coder files/versions/logs, agent tasks, repositories, branches, commits, artifacts, build runs, change history, prompt status + links now stored permanently.
- [x] Reload test: records created, app reloaded, every record still present.
- [x] Answer: "Execute In Coder" is disabled until the prompt status is Approved or Ready For Coding (not a mock).
- [x] Coder output writes all generated files immediately, creates a preview entry when needed, and previews without GitHub.
- [x] Module 16 Build Orchestration: requirement register, build plan, dependency/startup/compile validation, traceability matrix, build health dashboard, blocking gate + repair task.
- [ ] Blocked (needs user input): no AI engine key, so extraction / document generation / coding chat / agent runs cannot be exercised; no GitHub token, so repository operations cannot be exercised.
- [ ] Earlier project data (projects, discussions, extracted items) was lost with the previous disconnected backend — awaiting user decision on re-entering it.
- [x] Upgrade Pack V-02 → V-15: project memory overview, phased prompt execution, build traceability, context packages, outcome learning, failure analysis, discussion reopen, revision history, repository releases, engine activity log, structured + universal extraction, portable export/import, intelligence register. Report in IMPLEMENTATION-REPORT-V02-V15.md.
- [x] AI engine plumbing corrected for all five engines (OpenAI, DeepSeek, Perplexity, Gemini, Claude): correct endpoints, Claude's own protocol translated, per-engine key detection, valid model lists.
- [x] Coder preview errors: build tooling files (vite.config.ts etc.) excluded from preview/validation; misplaced relative imports resolved by unique file name.
- [ ] Perplexity / Gemini / Claude keys not stored yet — add them in Settings or ask for server-side secrets.
- [x] Lovable-style AI Coder workspace: adjustable 20/80 chat and preview split, retained tools, narrow-screen layout, and browser verification.

- [x] Repository compatibility engine + preview diagnostics (reports saved, repair & preview, AI sees diagnostics)

## Three-AI collaboration (VPIP feature request)
- [x] Phase 1: Admin AI page (separate page: GitHub read-only repo access, AI1/AI2 inputs, feedback, chat, improvement reports with approval)
- [x] Admin AI Phase 2: snapshots before every AI 1 run, history, stable releases, compare, exact restore, failure trace + recovery
- [x] Admin AI Full Admin — Stage 1: code search (text/references/imports/exports), Change Proposal approval request (Approve/Reject/Revise)
- [x] Stage 2: Implement = snapshot → new branch → apply → implementation + diff report → user merges/rejects/revises (never main)
- [x] Governance upgrade #1: Dependency tracing (impact, routes, APIs, DB objects, risk) + symbol/route/filename search
- [ ] Governance #2: Knowledge base + root cause engine
- [ ] Governance #3: Compare engine (snapshots/branches/commits/releases)
- [ ] Governance #4: Message Center
- [ ] Stage 3: AI1/AI2 message bus, implementation queue, separate Admin AI model setting, build/preview/runtime logs as input
- [ ] Phase 2: AI Message Center
- [ ] Phase 3: Separate AI settings per AI (provider, model, temperature, tokens, system prompt)
- [ ] Phase 4: Fill AI 2 gaps (extra report sections, runtime logs, Git status inputs)
