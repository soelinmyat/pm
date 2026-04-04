---
type: backlog-issue
id: PM-013
title: "pm:example Onboarding Command"
outcome: "New users who just installed PM can run /pm:example to see PM's own populated knowledge base dashboard, understand what PM produces, and start their first workflow confidently"
status: drafted
parent: null
children:
  - "pm-example-command-skill"
  - "pm-example-session-hook"
labels:
  - "onboarding"
priority: medium
evidence_strength: strong
scope_signal: small
strategic_fit: "GTM (Section 5): Product-led, community-driven distribution"
competitor_gap: unique
dependencies: []
created: 2026-03-13
updated: 2026-03-14
---

## Outcome

New users who just installed PM can run `/pm:example` to see PM's own populated knowledge base dashboard — landscape, competitors, strategy, research, and backlog — before setting up their own project. A terminal orientation prints before the browser opens, explaining what each section demonstrates. This reduces activation friction and gives users a concrete mental model of what they're building toward.

JTBD: "When I've just installed PM and have no data yet, help me understand what PM produces so I start my first workflow confidently."

## Acceptance Criteria

1. `/pm:example` opens the dashboard server pointed at `${CLAUDE_PLUGIN_ROOT}/pm/` and prints the URL.
2. Dashboard displays PM's landscape, competitors, strategy, research, and backlog.
3. Dashboard header shows "Product Memory" (via `.pm/config.json` at plugin root).
4. A terminal orientation prints before the URL — lists available sections and what each demonstrates, explicitly notes this is PM's own knowledge base (not the user's project).
5. SessionStart hook for unconfigured projects mentions `/pm:example`.
6. `/pm:example` works in a fresh project with no `.pm/config.json` (smoke-test: `CLAUDE_PLUGIN_ROOT` resolves before `/pm:setup`).

## User Flows

N/A — no user-facing workflow for this feature type.

## Wireframes

N/A — no user-facing workflow for this feature type.

## Competitor Context

No competitor offers a live demo of their own output:
- **PM Skills Marketplace:** README with screenshots. No live demo. No persistence — users can't see accumulated output.
- **ChatPRD:** Limited free tier (3 chats) as the "demo." No public showcase of output quality.
- **Productboard Spark:** 150 free credits as trial. Organizational memory is opaque — users can't preview what a mature knowledge base looks like.

PM's self-dogfooded dashboard is unique — it demonstrates the "compounding knowledge base" value prop from the first interaction.

## Technical Feasibility

**Verdict:** Feasible as scoped.

**Build-on:**
- `server.js` already supports `--dir` pointing at any path (`scripts/server.js:93-98`)
- `getProjectName` (`scripts/server.js:886-897`) reads `.pm/config.json` relative to pm directory parent
- `commands/view.md` is the direct template
- `CLAUDE_PLUGIN_ROOT` is established across hooks, skills, and agents

**Build-new:**
- `commands/example.md` — command file reading the skill
- `skills/example/SKILL.md` — skill with orientation + server launch
- `project_name` field in `.pm/config.json`
- One line in `hooks/check-setup.sh`

**Risks:**
- Ensure no trailing slash when passing `--dir` path (affects `getProjectName` resolution)
- Smoke-test `CLAUDE_PLUGIN_ROOT` in fresh unconfigured project

## Research Links

- No dedicated research topic — signal sources are embedded in strategy (Section 5 GTM) and landscape (keyword analysis).

## Notes

- Original PM-013 scope (public hosted demo dashboard for distribution/SEO) deferred to PM-023.
- The `pm/` directory at plugin root is now load-bearing for the demo experience — future refactors should preserve it.
- Consider mentioning PM's parallel agent architecture in the terminal orientation as a differentiator.
