---
name: design-critique
description: "Use after UI, UX, frontend, mobile, CSS, layout, visual, component, page, or interaction changes are implemented. Use when the user asks for design critique, UI review, visual QA, design pass, polish review, layout review, frontend review, or when pm:dev needs the mandatory PM-native design critique gate before QA, review, push, PR, or ship."
---

# pm:design-critique

## Purpose

PM-native post-implementation design critique gate. It captures real visual artifacts, reviews the changed UI for user-visible regressions and design quality, drives P0/P1 fixes, and records the gate in dev session state.

This skill replaces any dependency on external `/design-critique` availability inside PM workflows. It can use project tooling and PM references directly in every runtime.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution, telemetry, and custom instructions.

Read `${CLAUDE_PLUGIN_ROOT}/references/writing.md` before generating any output.

## Iron Law

**NEVER PASS A UI GATE WITHOUT VISUAL ARTIFACTS.** A design critique must inspect screenshots, captures, or an explicit blocked/skipped reason tied to the current commit.

## When NOT to use

- Backend-only, docs-only, generated-only, lockfile-only, or non-UI config-only changes with no user-visible UI impact.
- Before implementation exists. Use this after the changed UI can be run or inspected.
- Pure product strategy, copy-only proposal work, or research. Use the relevant PM planning skill instead.

## Workflow

**Workflow:** `design-critique` | **Telemetry steps:** `scope`, `capture`, `critique`.

## Steps

Read all `.md` files from `${CLAUDE_PLUGIN_ROOT}/skills/design-critique/steps/` in numeric filename order. If `.pm/workflows/design-critique/` exists, same-named files there override defaults. Execute each step in order.

Use `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/state-schema.md` for the gate manifest shape and `${CLAUDE_PLUGIN_ROOT}/scripts/dev-gate-check.js` for the checker contract.

## References

| Reference | Purpose |
|---|---|
| `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/design-critique.md` | Existing PM design critique flow, reviewer dispatch, and report format |
| `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/design-critique-capture-guide.md` | Platform detection, server lifecycle, screenshots, and enriched artifacts |
| `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/design-critique-seed-conventions.md` | Seed data conventions and edge-state checklist |
| `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/state-schema.md` | Markdown state and JSON gate sidecar schema |

## Red Flags - Self-Check

- **"The UI change is small, screenshots are overkill."** Small UI changes still break layout, contrast, and responsive behavior. Capture at least the affected state or record a valid skip.
- **"I can infer it from the diff."** Design quality is visual and interactional. Diffs are input, not evidence.
- **"The app will not start, so I will mark it passed."** Environment failure is blocked or skipped with a reason, never passed.
- **"An external design skill is unavailable, so the gate is unavailable."** This is the PM-native gate. Run the steps inline.
- **"P1 findings can be noted for later."** P0/P1 findings block the gate unless the user makes a product/design call to defer them.

## Escalation Paths

- **App cannot be rendered:** "Design critique blocked: I could not run or capture the changed UI because {reason}. Want me to fix the environment, accept a documented skip, or pause?"
- **P0/P1 design findings need product judgment:** "Design critique found blocking product/design tradeoffs: {summary}. Which direction should I take?"
- **Artifacts cannot be sanitized:** "Design critique blocked: the available screenshots expose private data. I need sanitized seed data before I can record artifacts."

## Common Rationalizations

| Excuse | Reality |
|---|---|
| "Tests cover it" | Tests do not prove layout, hierarchy, contrast, or visual state quality. |
| "No external critique skill exists" | PM owns this gate directly; external skills are optional, not required. |
| "I looked at the component code" | The gate requires rendered evidence or an explicit reason it cannot be rendered. |
| "Only low-risk UI changed" | Low risk still needs a lite capture and gate record. |

## Before Marking Done

- [ ] Visual artifacts or a valid blocked/skipped reason are saved.
- [ ] P0/P1 findings are fixed, re-captured, and re-reviewed, or escalated.
- [ ] `.pm/dev-sessions/{slug}.md` records the design critique outcome.
- [ ] `.pm/dev-sessions/{slug}.gates.json` has a `design-critique` row tied to the current commit.
- [ ] The user confirmed the final outcome or received a clear handoff with remaining non-blocking findings.
