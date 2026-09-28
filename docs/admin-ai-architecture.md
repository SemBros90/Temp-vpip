# Admin AI canonical backend architecture

## Old flow

```text
Admin Panel → React state / vpip_admin_ai_control
Admin AI → GitHub and separate control tables
```

The control display could therefore show information unavailable to the Admin
AI runtime.

## New flow

```text
Admin Panel → admin_ai_settings, admin_ai_modules, admin_ai_providers,
              admin_ai_actions, admin_ai_runtime_status
Admin AI Runtime → the same admin_ai_* tables (read-only service access)
```

`src/lib/admin-ai-service.ts` is the single client-side service boundary. The
runtime authorization in `src/routes/api/ai.chat.ts` queries the same settings
and module records before it accepts an Admin AI request. The Admin AI chat
also puts a fresh database configuration snapshot into its system context, so
questions about provider, model, enabled modules, permissions, and connection
state are answered from records rather than repository inspection.

## Modified files

- `drizzle/migrations/0022_admin_ai_canonical_backend.sql`
- `src/lib/admin-ai-service.ts`
- `src/lib/vpip/admin-ai-control.ts`
- `src/components/vpip/AdminAiControl.tsx`
- `src/routes/admin-ai.tsx`
- `src/routes/api/ai.chat.ts`
