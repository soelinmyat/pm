---
name: bug
description: "Use when something broke, a regression, unexpected behavior, or 'this is broken' — file a bug. Writes a backlog item with `kind: bug` that `pm:dev` routes straight to fix without grooming ceremony."
---

# pm:bug

## Purpose

Capture a bug report into the backlog in one pass — no grooming, no RFC. The resulting item has `kind: bug` and is picked up by `pm:dev` on a lean path (skips groom/RFC, still runs `pm:review`). Use this when something is broken and the fix should go through implementation directly.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution and runtime conventions.

Document output (the backlog body) follows `${CLAUDE_PLUGIN_ROOT}/references/writing.md`.

## Iron Law

**NEVER LET A BUG REPORT EVAPORATE.**

## Hard rules

- **NEVER LET A BUG REPORT EVAPORATE.** If the user says something is broken or a regression slipped in, capture it before the conversation moves on. Observed/expected/reproduction context turns a vague complaint into an actionable fix — collect it at capture time, even one line each. A title without observed/expected is a complaint, not a bug report.
- **Capture the symptom, don't diagnose it.** Root-cause analysis is `pm:dev` territory; the fix agent picks it up from the RFC-skipping routing. File now.
- **If the user thinks something is wrong, capture it** — non-reproducible bugs still go in the backlog, and reproduction steps can be added later via enrich. Repros decay from memory, so a one-line reproduction now saves debugging time later.
- **Use the right kind and priority.** `kind: bug` signals a regression, not new work — don't file it as a task. `high` is the default priority; downgrade to `medium`/`low` for cosmetic or rare issues rather than defaulting everything to critical.
- **Before done:** the backlog file exists at `{pm_dir}/backlog/{slug}.md` with `kind: bug`, its body has `## Observed`, `## Expected`, and `## Reproduction` (stubs OK), it passes `npm run validate`, and the user saw the one-line confirmation with slug + id + next-step hint.

## When NOT to use

- **Chore or small cleanup** that isn't a bug. Use `pm:task`.
- **Feature gap** — the feature works, but the user wants more. Use `pm:groom`.
- **Product signal** (customer feedback, observation). Use `pm:note`.
- **Immediate help** — the user wants you to investigate the bug *right now*, not track it. Investigate directly; capture after if the fix is non-trivial.

**Workflow:** `bug` | **Telemetry steps:** `capture`, `enrich`, `validate`

**Steps:** Read all `.md` files from `${CLAUDE_PLUGIN_ROOT}/skills/bug/steps/` in numeric filename order. If `.pm/workflows/bug/` exists, same-named files there override defaults. Execute each step in order — each step contains its own instructions.

## Escalation Paths

- **Work is a feature, not a fix:** "This looks like a feature gap rather than a regression — want to use `/pm:groom` so we can scope the improvement?"
- **User is describing a chore:** "This sounds like a chore, not a regression. Want to use `/pm:task` instead so the priority default isn't `high`?"
- **Title too vague:** Stop and ask: "I can save it, but I need one concrete sentence describing what's broken. What did you observe?"

## Red Flags — Self-Check

- **"I should diagnose before capture."** Stop and capture the symptom while reproduction context is fresh.
- **"A task is close enough."** Use `kind: bug` so routing and priority defaults remain correct.
- **"Missing reproduction means no bug."** Capture a pending stub and keep the report actionable.
- **"I can edit the file directly."** Use the atomic helper and validate its collision protection.

## Common Rationalizations

| Excuse | Reality |
|---|---|
| "The user only mentioned it casually." | Regressions decay from memory unless captured immediately. |
| "Observed and expected are obvious." | Explicit contrast is what makes a report actionable. |

## Before Marking Done

- [ ] The atomic backlog artifact exists with `kind: bug` and no overwritten file.
- [ ] Observed, expected, and reproduction sections are present.
- [ ] Validation passed and the user received the `/pm:dev` next-step hint.
