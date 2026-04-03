---
name: design-critique
description: "Multi-agent design critique against real running app with seed data. 3 designers + Fresh Eyes review actual pages via Playwright CLI (web) or Maestro MCP (mobile)."
---

# Design Critique Skill

## Overview

Three parallel designer sub-agents plus a Fresh Eyes reviewer examine screenshots captured from real running applications (not Storybook). A PM agent frames the review and consolidates findings.

**Two modes:**

- **Embedded** (called from `/dev`). Acts as a review service. Returns consolidated findings to the implementing agent, which applies fixes itself.
- **Standalone** (invoked directly). Full self-contained flow with its own engineer agent that captures screenshots, applies fixes, and iterates.

**Screenshot sources.** Always real servers with seed data in the database. Web pages are captured via Playwright CLI. Mobile screens are captured via Maestro MCP tools. Never Storybook, never MSW mocks.

### Reference Files

| File | Purpose |
|------|---------|
| `${CLAUDE_PLUGIN_ROOT}/skills/design-critique/references/designer-prompts.md` | 3 designer agent dispatch refs, scoring rubric, grade computation |
| `${CLAUDE_PLUGIN_ROOT}/skills/design-critique/references/fresh-eyes-prompt.md` | Zero-context regression reviewer prompt |
| `${CLAUDE_PLUGIN_ROOT}/skills/design-critique/references/pm-prompts.md` | PM Framing (inline), Conflict Resolution (inline), Bar-Raiser (agent dispatch) |
| `${CLAUDE_PLUGIN_ROOT}/skills/design-critique/references/capture-guide.md` | Platform detection, server lifecycle, screenshot capture sequences |
| `${CLAUDE_PLUGIN_ROOT}/skills/design-critique/references/seed-conventions.md` | Seed task conventions, template, edge case checklist |

---

## Mode Detection

```
MODE detection:
  .pm/dev-sessions/*.md exists (or legacy .dev-state-*.md at repo root)  ->  "embedded"
  Otherwise                            ->  "standalone"

PLATFORM detection:
  Per ${CLAUDE_PLUGIN_ROOT}/skills/design-critique/references/capture-guide.md
  Summary:
    {APP_PATH}/app.config.ts or app.json exists  ->  "rn" (React Native / Expo)
    package.json contains "expo" or "react-native" ->  "rn"
    Otherwise                                      ->  "web"
```

---

## Size Routing

| Size | PM Framing | Designers | Fresh Eyes | Max Rounds | PM Bar-Raiser |
|------|-----------|-----------|------------|------------|---------------|
| S | Skip (use ticket) | 3 parallel | Skip | 1 | Skip |
| M/L/XL | Full | 3 parallel | Yes | 3 | Full |

---

## Embedded Mode Flow (called from /dev)

No engineer agent. Returns findings to the calling agent.

**Input:** Screenshots at `/tmp/design-review/{feature}/`, manifest, page context from `.pm/dev-sessions/{slug}.md`.
**Output:** Consolidated findings (P0/P1/P2) + Design Score + AI Slop Score.

### Flow

1. **Read screenshots** from manifest at `/tmp/design-review/{feature}/manifest.md`.
2. **Read page context** from `.pm/dev-sessions/{slug}.md` (or legacy `.dev-state-*.md`).
3. **Read CLAUDE.md** design principles from the project root.
4. **PM Framing** (M+ only). Dispatch PM sub-agent per `${CLAUDE_PLUGIN_ROOT}/skills/design-critique/references/pm-prompts.md`.
5. **Dispatch 3 designer sub-agents in parallel** per `${CLAUDE_PLUGIN_ROOT}/skills/design-critique/references/designer-prompts.md`. Each receives: all screenshots (via Read tool), manifest, CLAUDE.md design principles, PM brief (if available).
6. **Dispatch Fresh Eyes sub-agent** (M+ only) per `${CLAUDE_PLUGIN_ROOT}/skills/design-critique/references/fresh-eyes-prompt.md`.
7. **PM Conflict Resolution.** Dispatch PM sub-agent to consolidate all designer and Fresh Eyes reports into a single prioritized list.
8. **Return** consolidated findings + scores to the calling agent.

### Verify Mode (re-invocation after fixes)

Same flow, with these differences:

- Designer sub-agents also receive the previous round's findings for comparison.
- Fresh Eyes still gets zero context. It never sees prior findings.
- PM adds the round number to the brief.

---

## Standalone Mode Flow

Full self-contained flow for when there is no implementing agent.

1. **User provides:** app path, page/screen, description.
2. **Platform detection** per `${CLAUDE_PLUGIN_ROOT}/skills/design-critique/references/capture-guide.md`.
3. **Size classification** from description complexity.
4. **Engineer agent** (teammate, not sub-agent, since it edits files):
   a. Create seed task if none exists (per `${CLAUDE_PLUGIN_ROOT}/skills/design-critique/references/seed-conventions.md`).
   b. Start servers (per `${CLAUDE_PLUGIN_ROOT}/skills/design-critique/references/capture-guide.md`).
   c. Run seed, capture screenshots to `/tmp/design-review/{feature}/`, write manifest.
5. **PM Framing** (M+ only).
6. **3 Designers** review in parallel.
7. **Fresh Eyes** (M+ only).
8. **PM Conflict Resolution.**
9. **Engineer fixes** findings (P0 and P1).
10. **Re-capture, re-review** (max 3 rounds).
11. **PM Bar-Raiser** (M+ only).
12. **Final report** written to `/tmp/design-review/{feature}/final-report.md`.
13. **Commit changes.**

---

## Agent Dispatch Patterns

All reviewers are **sub-agents** (not teammates). Their results return directly to the orchestrator context. The only exception is the engineer in standalone mode, which is a **teammate** because it edits files.

```
# Designers (3 parallel sub-agents -- formal plugin agents)
Agent({ subagent_type: "pm:design-director", prompt: "..." })      // Designer A: UX Quality + Content
Agent({ subagent_type: "pm:qa-lead", prompt: "..." })               // Designer B: Resilience + Accessibility
Agent({ subagent_type: "pm:design-system-lead", prompt: "..." })    // Designer C: Design System + Visual Polish

# Fresh Eyes (1 sub-agent, M+ only)
Agent({ subagent_type: "general-purpose", prompt: "..." })  // no team_name! (no dedicated agent -- zero-context by design)

# PM phases
# PM Framing -- inline prompt (orchestration step, not independent perspective)
# PM Conflict Resolution -- inline prompt (orchestration step, not independent perspective)
Agent({ subagent_type: "pm:product-director", prompt: "..." })  // PM Bar-Raiser (M+ only)

# Engineer (standalone mode only -- needs to edit files, so use teammate)
Agent({ team_name: "design-critique", name: "engineer", subagent_type: "general-purpose", prompt: "..." })
```

### What each designer agent receives

- All screenshots (read via Read tool)
- The manifest from `/tmp/design-review/{feature}/manifest.md`
- CLAUDE.md design principles
- PM brief (if available)
- Previous round findings (verify mode only, NOT for Fresh Eyes)

---

## Final Report Format

```markdown
# Design Critique Report

**Feature:** {feature}
**Platform:** {web/mobile}
**Rounds:** {N}
**Date:** {date}

## Scores
- **Design Score:** {A-F}
- **AI Slop Score:** {A-F} ({Pass/Fail})

## Category Grades
{all categories with grades}

## Resolved Findings
{findings that were fixed during iteration}

## Remaining Items
{P2 items deferred to backlog}

## PM Verdict (M+ only)
{Ship / Elevate / Rethink with rationale}
```

---

## Critical Rules

1. **NEVER skip PM conflict resolution.** Even for S-size (just skip PM framing, not consolidation).
2. **ALL designer agents run in parallel as sub-agents** (not teammates).
3. **Fresh Eyes NEVER receives prior context.** No prior findings, no round history, no previous screenshots.
4. **Screenshots come from real running apps.** NEVER from Storybook.
5. **Seed data from rake tasks.** NEVER from MSW mocks.
6. **Max 10 screenshots per capture round.**
7. **Max 3 iteration rounds,** then PM bar-raiser decides.
8. **In embedded mode, return findings only.** Do NOT fix issues. The implementing agent does that.
