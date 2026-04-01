# Plan: PM-106 — Dev skill canvas writes

## Summary

Extend the dev skill references to write canvas HTML at stage transitions. This is a plugin skill change, not a server change.

## Tasks

### Task 1: Create dev canvas HTML template function

Add a helper in `scripts/server.js` (or a shared template) that generates dev canvas HTML:
- Issue title + ID
- Current stage (stepper: intake → workspace → implement → review → ship → merged)
- Test results (pass/fail count)
- PR link (when available)
- For epics: sub-issue progress table

Actually — the dev canvas HTML is written by the skill (agent), not by the server. The server just serves whatever is in `current.html`. So this task is about documenting the template pattern for dev skills to follow, and updating the skill references.

### Task 2: Update epic-implementation-flow.md

Add canvas write instructions to the implementation flow reference:
- After each stage transition, write `.pm/sessions/dev-{slug}/current.html`
- Emit `canvas_update` SSE event via emit-event.sh
- Write `.state` file (`active` during work, `idle` when waiting, `completed` when merged)

### Task 3: Update single-issue-flow.md

Same as Task 2 but for single-issue dev flow.

### Task 4: Create a canvas HTML template reference

New file: `skills/dev/references/canvas-template.md` with the HTML structure dev agents should write. Includes stepper, test results section, PR status section.

### Task 5: Test

- Manual: run a dev session, verify canvas appears on dashboard
- Automated: test that /session/{slug} serves dev canvas HTML when present

## Files Changed

| File | Change |
|------|--------|
| `skills/dev/references/epic-implementation-flow.md` | Add canvas write instructions |
| `skills/dev/references/single-issue-flow.md` | Add canvas write instructions |
| `skills/dev/references/canvas-template.md` | New — dev canvas HTML template |
| `tests/server.test.js` | Dev canvas serving test |
