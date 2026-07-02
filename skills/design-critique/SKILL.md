---
name: design-critique
description: "Use after UI, UX, frontend, mobile, CSS, layout, visual, component, page, or interaction changes are implemented. Use when the user asks for design critique, UI review, visual QA, design pass, polish review, layout review, frontend review, or when pm:dev needs the mandatory PM-native design critique gate before QA, review, push, PR, or ship."
---

# pm:design-critique

## Purpose

PM-native post-implementation design critique gate. It captures real visual artifacts, reviews the changed UI for user-visible regressions and design quality, drives P0/P1 fixes, and records the gate in dev session state.

This skill replaces any dependency on external `/design-critique` availability inside PM workflows. It can use project tooling and PM references directly in every runtime.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution and runtime conventions. Output follows `${CLAUDE_PLUGIN_ROOT}/references/writing.md`.

## When NOT to use

- Backend-only, docs-only, generated-only, lockfile-only, or non-UI config-only changes with no user-visible UI impact.
- Before implementation exists. Use this after the changed UI can be run or inspected.
- Pure product strategy, copy-only proposal work, or research. Use the relevant PM planning skill instead.

## Workflow

**Workflow:** `design-critique`

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

## Hard rules

- Never pass a UI gate without visual artifacts — a critique must inspect screenshots/captures of the changed UI, or record an explicit blocked/skipped reason tied to the current commit. A diff is input, not evidence, and small UI changes still break layout, contrast, and responsive behavior.
- Environment failure (the app won't start or render) is `blocked` or `skipped` with a reason — never `passed`.
- P0/P1 findings block the gate until fixed, re-captured, and re-reviewed — or the user makes an explicit product/design call to defer them.
- Record the outcome in `.pm/dev-sessions/{slug}.md` and a `design-critique` row in `.pm/dev-sessions/{slug}.gates.json` tied to the current commit.
- This is the PM-native gate — run the steps inline; external design skills are optional, never required. Never record artifacts that expose private data; sanitize with seed data first.

## Escalation Paths

- **App cannot be rendered:** "Design critique blocked: I could not run or capture the changed UI because {reason}. Want me to fix the environment, accept a documented skip, or pause?"
- **P0/P1 design findings need product judgment:** "Design critique found blocking product/design tradeoffs: {summary}. Which direction should I take?"
- **Artifacts cannot be sanitized:** "Design critique blocked: the available screenshots expose private data. I need sanitized seed data before I can record artifacts."
