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
- [ ] Lovable-style AI Coder workspace: adjustable 20/80 chat and preview split, retained tools, narrow-screen layout, and browser verification.
