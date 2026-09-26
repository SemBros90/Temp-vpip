<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- AI 2 Auditor (src/lib/vpip/auditor.ts, AuditorPanel.tsx) is read-only: it stores audits in vpip_ai2_audits and only hands prompts to the Coder input; why: spec VPIP-AI2-001 forbids AI 2 editing, committing or deploying.
- "lovable" engine in /api/ai/chat routes to the Lovable AI Gateway Responses API with LOVABLE_API_KEY; why: works without user provider keys.
- Admin AI (src/routes/admin-ai.tsx, src/lib/vpip/admin-ai.ts) is advisory and GitHub read-only; data in vpip_admin_ai_* tables; why: spec forbids auto deploy/merge/push/modify of VPIP.
- Admin AI recovery (src/lib/vpip/admin-recovery.ts, AdminRecovery.tsx) reuses vpip_repo_snapshots with labels in metadata; AI 1 send() refuses to run if the pre-run snapshot fails; why: deterministic exact-file restore, human-approved only.
