# Vaigyanic Project Intelligence Platform (VPIP)

## One important constraint first

Lovable builds web applications. A true Electron desktop app that writes directly into folders on your hard disk cannot be built or run here. Everything else in your spec can be built, with this adaptation:

- The app is **desktop-first** (wide layout, sidebar, keyboard-friendly, built for a large screen).
- All project data is stored **locally in your browser** (no cloud, no server, no account). Nothing leaves your machine except the AI requests you trigger.
- Data is kept in the exact human-readable shapes you described: Markdown for discussions/documents/prompts/knowledge, JSON for metadata and indexes.
- **Export / Import**: any project (or the whole workspace) can be exported as a ZIP with the full folder structure (Discussions, KnowledgeInbox, Decisions, Requirements, Ideas, Risks, Questions, Documents, Prompts, Attachments, Snapshots, project.json) and re-imported later. So you still own the files.
- Optional later: the same codebase can be wrapped in Electron outside Lovable, and the storage layer is written behind one interface so swapping browser storage for real file-system writes is a contained change.

## V1 scope (built in this pass)

**Shell & navigation**
Sidebar: Projects list, and within a project — Dashboard, Discussions, Knowledge Inbox, Master Register, Knowledge Explorer, Documents, Prompts, Snapshots, Settings.

**Module 1 — Projects**
Create, open, rename, archive, delete. Dashboard with counts (discussions, decisions, requirements, risks, questions, prompts, documents), connected providers, last activity.

**Module 2 — AI providers**
OpenAI and DeepSeek. API keys stored locally on the device, model selection, default provider, connection test, live status. Switching provider never touches project memory.

**Module 3 — Discussion workspace**
Typed discussions (General, Requirement, Architecture, Decision, Research, Risk, Prompt, Business, Other). Streaming chat, every message auto-saved with timestamp, provider and model. Attachments (PDF/image/text) stored with the discussion, text extracted where possible. Search, history, AI summary, export to Markdown.

**Module 4 — Memory engine**
Real-time save on every message, periodic auto-save with configurable interval, manual save, per-discussion and per-project backup, snapshot creation.

**Module 5 + 6 — Extraction & Knowledge Inbox**
On demand or after a discussion, the AI extracts Decision / Requirement / Idea / Risk / Question / Assumption candidates. Nothing is auto-approved — candidates land in the Inbox with Approve, Reject, Edit, Merge.

**Module 7 + 8 — Master Register & Explorer**
Approved items become official knowledge, sectioned by type, with search, filter, sort, jump to source discussion and related items.

**Module 9 — Context retrieval**
Ask a project-level question; the app searches discussions, decisions, requirements, documents and prompts, builds a context package, sends it to the selected provider, and returns the answer with clickable references to the sources used.

**Module 10 — Document generator**
Project Summary, Decision Register, Requirement Register, Architecture Summary, Discussion Summary, Research Summary, Project Knowledge Book. Saved permanently in the project.

**Module 11 — Prompt generator**
Lovable, Replit, Architecture, Research, Business, Custom prompts — versioned (V1, V2, ...) and stored as project assets.

**Traceability**
Every knowledge object carries ID (D-001, R-001, ...), title, description, source discussion, source message range, AI provider, author, creation date and revision history.

**Snapshots**
Any generated document, prompt, summary or report creates a permanent, immutable snapshot.

**Settings**
Provider keys, default provider/model, auto-save interval, export/import, storage usage and reset.

## Technical notes

- React + TypeScript + Vite (TanStack Router), Tailwind design system, desktop-density UI.
- Storage layer: IndexedDB behind a `VaultStore` interface mirroring a file tree (`projects/<id>/Discussions/<id>.md` etc.), so every record is a real Markdown or JSON blob with front-matter metadata.
- AI calls go straight from the app to OpenAI / DeepSeek with your key; provider adapters share one interface so more engines can be added.
- ZIP export via `jszip`; PDF text extraction for attachments where the browser can do it, otherwise the file is stored as-is.
- Visual direction: dark, dense, engineering-console aesthetic — monospace accents, precise borders, no consumer-app gloss.

## Not in V1

Electron packaging, real OS file-system writes, cloud sync, multi-user collaboration, vector embeddings (retrieval uses keyword + structured search first).
