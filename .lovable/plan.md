# Lovable-style AI Coder workspace

## Goal
Turn the existing AI Coder screen into an adjustable two-pane workspace: coding chat on the left and live preview on the right, with the preview occupying 80% by default.

## What will change
- Replace the fixed file/chat/preview columns with a draggable 20/80 split.
- Keep the coding chat permanently visible in the left pane, including provider, mode, messages, attachments/actions, and send/stop controls.
- Make the right pane preview-first, with a browser-style toolbar, refresh, entry selection, and preview error indicator.
- Move Files, Build Manager, Editor, History, Agent, Actions, Database, Terminal, and logs into accessible tabs/drawers around the two primary panes; no existing capability is removed.
- Add quick controls to reset the split, maximize preview, and reopen the left pane.
- Preserve the existing dark VPIP design system and all current build/session behavior.
- Make the layout adapt at narrower widths by stacking chat and preview instead of clipping them.

## Technical details
- Use the existing `react-resizable-panels` package for keyboard-accessible dragging and remembered panel proportions.
- Build chat rendering and the composer from AI Elements primitives, while retaining VPIP's current streaming and traceability logic.
- Keep the preview iframe and generated-file pipeline unchanged; only its surrounding workspace is reorganized.
- Store layout preference locally per browser so reopening the coder keeps the user's chosen split.
- Verify the coder at desktop and narrow widths, including resizing, chat submission controls, preview refresh, tool access, and runtime console errors.

## Scope
No database schema, AI connector, prompt, build, repository, or persistence changes.
