# Phase D-01 — Discovery Engine (AI-guided project interview)

A new, self-contained **Discovery** area inside each project. Nothing outside it changes (Requirements, Risks, Decisions, Assumptions, Documents, Knowledge Inbox, Prompt Generator, Runtime, Repositories, Build Sessions, Browser Preview, GitHub stay untouched).

## What the user gets

**1. Start** — Project > Discovery > "New discovery". Type one sentence ("I want to build a medical tourism platform"). No templates.

**2. Interview rounds** — the AI picks the 1–3 most valuable unanswered questions (re-ranked after every answer). Each question card shows:
- Type: single choice, multiple choice (default), yes/no, dropdown, or short free text (only when needed)
- AI-suggested answers
- Always: "Other: ____", "Not sure", "Skip question"

**3. Knowledge board (always visible, right side)** — three columns:
- **Confirmed** — what the user answered/approved
- **Assumptions** — AI inferences, each with Approve / Reject (approve moves it to Confirmed)
- **Unknown** — still missing

**4. Readiness dashboard** — 7 categories (Project Definition, Users & Roles, Business Model, Features, Workflow, Integrations, Technology), each with % and Red/Orange/Yellow/Green. Overall readiness colours the progression buttons.

**5. Maturity level** — Level 0 Idea → 1 Concept → 2 Business → 3 Functional → 4 Build Ready, shown in the header.

**6. Controls** — Continue Discovery / Move to Next Phase / Finish Discovery, usable at any time. An advisory AI recommendation panel says when the definition looks sufficient; it never forces anything.

**7. Edit previous answers** — answer history list; editing keeps the old answer as inactive and makes the new one active.

**8. Outputs (on Move to Next Phase)** — generated inside Discovery, never blocked by gaps: Project Definition, Requirements, Assumptions, Risks, Decisions, Modules, Roadmap, Build Plan. Gaps stay marked Assumption/Unknown. Outputs are stored as Discovery documents only — not pushed into the existing registers.

**9. Reopen** — "Return to Discovery" on finished sessions; update answers and regenerate outputs (new version, old kept).

**10. Discovery Audit** — read-only page with search, filters (session, event type, date), pagination, CSV/JSON export. Logs: question generated (+type), answer selected/modified, assumption created/approved/rejected, readiness change, maturity change, move to next phase, finish discovery. "User" is recorded as the single owner (no login, per project rules).

## Technical details

- **Database (new tables only, grants + RLS matching existing single-owner pattern):** `vpip_discovery_sessions` (project_id, idea, status, maturity, readiness jsonb), `vpip_discovery_questions` (session, round, type, text, choices, category, priority), `vpip_discovery_answers` (question, value, is_active, superseded_by), `vpip_discovery_knowledge` (session, category, status confirmed/assumption/unknown, statement, source), `vpip_discovery_outputs` (session, version, kind, markdown), `vpip_discovery_audit` (session, event, detail jsonb, created_at).
- **AI:** new `src/lib/vpip/discovery.ts` using the existing `completeChat` path and the project's selected provider (no changes to the AI Providers module). Each round returns strict JSON: questions (max 3, with type/choices/category/priority), updated knowledge items, per-category completeness, recommendation. The app enforces Other/Not sure/Skip and the 3-question cap in code, and computes readiness/maturity itself from category completeness (thresholds: <25 red, <50 orange, <75 yellow, else green; maturity by which categories pass).
- **Data access:** `src/lib/vpip/discovery-db.ts` (direct, independent of the main workspace store so autosave is not affected).
- **Routes:** `projects.$projectId.discovery.index.tsx` (session list + new), `projects.$projectId.discovery.$sessionId.tsx` (interview), `projects.$projectId.discovery.audit.tsx`. One added nav link in the project sidebar (only change to the shared Shell).
- **Validation (Section R):** after build, a Playwright run exercising start → answer (single/multi/Other/Not sure/Skip) → edit answer → approve/reject assumption → move to next phase → reopen → audit export; results reported back.

## Out of scope
No changes to existing registers or Inbox, no code generation, no repository changes, no Safe Repair.
