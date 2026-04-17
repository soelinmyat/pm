---
name: bug
description: "Use when something broke, a regression, unexpected behavior, or 'this is broken' — file a bug. Writes a backlog item with `kind: bug` that `pm:dev` routes straight to fix without grooming ceremony."
---

# pm:bug

## Purpose

Capture a bug report into the backlog in one pass — no grooming, no RFC. The resulting item has `kind: bug` and is picked up by `pm:dev` on a lean path (skips groom/RFC/simplify, still runs `pm:review`). Use this when something is broken and the fix should go through implementation directly.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution and interaction pacing.

Read `${CLAUDE_PLUGIN_ROOT}/references/writing.md` before generating any output.

## Iron Law

**NEVER LET A BUG REPORT EVAPORATE.** If the user says something is broken or a regression slipped in, capture it before the conversation moves on. Observed/expected/reproduction context is what turns a vague complaint into an actionable fix — collect it at capture time, not later.

## When NOT to use

- **Chore or small cleanup** that isn't a bug. Use `pm:task`.
- **Feature gap** — the feature works, but the user wants more. Use `pm:groom`.
- **Product signal** (customer feedback, observation). Use `pm:note`.
- **Immediate help** — the user wants you to investigate the bug *right now*, not track it. Investigate directly; capture after if the fix is non-trivial.

**Workflow:** `bug` | **Telemetry steps:** `capture`, `enrich`.

**Steps:** Read all `.md` files from `${CLAUDE_PLUGIN_ROOT}/skills/bug/steps/` in numeric filename order. If `.pm/workflows/bug/` exists, same-named files there override defaults. Execute each step in order — each step contains its own instructions.

## Red Flags — Self-Check

If you catch yourself thinking any of these, you're drifting off-skill:

- **"I'll skip observed/expected — the title is descriptive enough."** A title without observed/expected is a complaint, not a bug report. Capture them even if one-line each.
- **"Let me diagnose the root cause before filing."** That's `pm:dev` territory. Capture the symptom now; the fix agent picks up root-cause analysis from the RFC-skipping routing.
- **"This might not be a real bug."** If the user thinks something is wrong, capture it. Non-reproducible bugs still go in the backlog — reproduction steps can be added later via enrich.

## Escalation Paths

- **Work is a feature, not a fix:** "This looks like a feature gap rather than a regression — want to use `/pm:groom` so we can scope the improvement?"
- **User is describing a chore:** "This sounds like a chore, not a regression. Want to use `/pm:task` instead so the priority default isn't `high`?"
- **Title too vague:** "I can save it, but I need one concrete sentence describing what's broken. What did you observe?"

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "The title says it all — I don't need a reproduction" | Repros decay from memory. A one-line reproduction captured now saves 10x the debugging time later. |
| "Priority should be critical, always — bugs are urgent" | Not every bug is urgent. `high` is the default; downgrade to `medium`/`low` if this is cosmetic or rare. |
| "I'll capture as a task since it's smaller" | `kind: bug` signals to the implementer that this is a regression, not new work. Use the right kind. |

## Before Marking Done

- [ ] Backlog file written at `{pm_dir}/backlog/{slug}.md` with `kind: bug`
- [ ] Body contains `## Observed`, `## Expected`, `## Reproduction` sections (stubs are OK when info is missing)
- [ ] File passes `npm run validate`
- [ ] User saw the one-line confirmation with slug + id + next-step hint
