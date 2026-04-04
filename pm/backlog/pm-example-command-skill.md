---
type: backlog-issue
id: PM-021
title: "Create pm:example command and skill files"
outcome: "The /pm:example command exists, prints a terminal orientation, and opens PM's dogfooded dashboard"
status: drafted
parent: "public-demo-dashboard"
children: []
labels:
  - "onboarding"
priority: medium
created: 2026-03-14
updated: 2026-03-14
---

## Outcome

The `/pm:example` command exists and opens PM's own dogfooded dashboard with a terminal orientation message that explains what each section demonstrates. Users see the dashboard header as "Product Memory" and understand this is PM eating its own cooking.

## Acceptance Criteria

1. `commands/example.md` exists with description and reads `${CLAUDE_PLUGIN_ROOT}/skills/example/SKILL.md`.
2. `skills/example/SKILL.md` contains the full flow: print orientation, run `server.js --mode dashboard --dir ${CLAUDE_PLUGIN_ROOT}/pm` (no trailing slash), parse JSON, print URL.
3. Terminal orientation lists sections (landscape, competitors, strategy, research, backlog), explains what each demonstrates, and notes "This is PM's own knowledge base — built by running the same commands you'll use."
4. `.pm/config.json` at plugin root contains `project_name: "Product Memory"`.
5. Works in a fresh project where `CLAUDE_PLUGIN_ROOT` is set but no `.pm/config.json` exists in the user's project.

## User Flows

N/A — no user-facing workflow for this feature type.

## Wireframes

N/A — no user-facing workflow for this feature type.

## Competitor Context

No editor-native PM tool provides an onboarding demo of its own output. PM Skills Marketplace has no persistence to demo. ChatPRD and Productboard Spark are browser SaaS with no terminal presence.

## Technical Feasibility

**Verdict:** Feasible as scoped.

**Build-on:**
- `commands/view.md` — direct template, swap `--dir` value
- `skills/view/SKILL.md` — flow template (check dir, start server, parse JSON, emit URL), remove the pm/ existence check
- `server.js --dir` — existing flag, zero server changes
- `CLAUDE_PLUGIN_ROOT` — established pattern across codebase

**Build-new:**
- `commands/example.md` — ~5 lines
- `skills/example/SKILL.md` — ~30 lines
- `project_name` field in `.pm/config.json` — one-line JSON edit

**Sequencing:**
1. Add `project_name` to `.pm/config.json` (unblocks dashboard header)
2. Create `skills/example/SKILL.md` (forces orientation message to be decided)
3. Create `commands/example.md` (derived from finalized skill)

## Research Links

- No dedicated research topic.

## Notes

- Use the `commands/view.md` pattern (call `server.js` directly) — do NOT use a shell helper or Skill tool delegation.
- Trailing slash on `--dir` path will break `getProjectName` resolution — ensure the path is `${CLAUDE_PLUGIN_ROOT}/pm` not `${CLAUDE_PLUGIN_ROOT}/pm/`.
