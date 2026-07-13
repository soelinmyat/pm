---
name: capture
description: "Use when the user says capture this, file a task, or save a small actionable item."
skill-class: capture
---

# Capture

## Purpose

Save one bounded item with the minimum routing metadata needed by the backlog.

## Iron Law

**NEVER OVERWRITE AN EXISTING CAPTURE.**

## When NOT to use

Do not use for discovery or implementation; route those requests to `pm:think` or `pm:dev`.

**Workflow:** `capture` | **Telemetry steps:** `write`

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution, telemetry, and custom instructions.
Read `${CLAUDE_PLUGIN_ROOT}/references/writing.md` before generating any output.

## Red Flags — Self-Check

- **"I can reuse that filename."** Stop and allocate a collision-free ID instead.
- **"The title is enough."** Include the outcome and routing kind before writing.
- **"I should expand the scope."** Capture only the user-requested item.
- **"Validation can wait."** Validate the saved artifact before reporting success.

## Escalation Paths

- If the request needs product discovery, switch to `pm:think`.
- If required routing is ambiguous, stop and ask one focused question.

## Common Rationalizations

| Excuse | Reality |
|---|---|
| "It is only a note." | Captures still need stable identity and routing. |
| "The directory is trusted." | Existing files must never be replaced. |

## Before Marking Done

- [ ] The capture artifact is saved atomically.
- [ ] The user-requested outcome is represented accurately.
- [ ] Validation and collision gates passed.
