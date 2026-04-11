---
name: design-critique
description: "Design review against real running app with seed data. Single focused reviewer + Fresh Eyes examine actual pages via Playwright CLI (web) or Maestro MCP (mobile)."
---

# Design Critique Skill

## Overview

One design reviewer examines screenshots captured from real running applications with seed data in the database. A separate Fresh Eyes reviewer (zero-context) catches regressions and context bias. All findings are backed by accessibility snapshots and visual consistency audits where possible.

## Telemetry (opt-in)

If analytics are enabled, read `${CLAUDE_PLUGIN_ROOT}/references/telemetry.md`.

Read `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/agent-runtime.md` for runtime-specific reviewer and worker dispatch.
Read `${CLAUDE_PLUGIN_ROOT}/references/capability-gates.md` for shared capability classification.

Minimum coverage for `design-critique`:
- run start / run end
- one step span for `capture`
- one step span for `review`
- one step span for `fresh-eyes`
- one step span for each re-review round when standalone mode iterates

**Two modes:**

- **Embedded** (called from `/dev`). Acts as a review service. Returns findings to the implementing agent, which applies fixes itself.
- **Standalone** (invoked directly). Full self-contained flow with its own engineer worker that captures screenshots, applies fixes, and iterates.

**Screenshot sources.** Always real servers with seed data in the database. Web pages are captured via Playwright CLI. Mobile screens are captured via Maestro MCP tools. Never Storybook, never MSW mocks.

### Reference Files

| File | Purpose |
|------|---------|
| `${CLAUDE_PLUGIN_ROOT}/skills/design-critique/references/reviewer-prompt.md` | Design reviewer dispatch context |
| `${CLAUDE_PLUGIN_ROOT}/skills/design-critique/references/fresh-eyes-prompt.md` | Zero-context regression reviewer prompt |
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

## Embedded Mode Flow (called from /dev)

No engineer agent. Returns findings to the calling agent.

**Input:** Screenshots at `/tmp/design-review/{feature}/`, manifest, enriched artifacts (a11y snapshots, consistency audit), page context from `.pm/dev-sessions/{slug}.md`.
**Output:** Prioritized findings (P0/P1/P2) with confidence tiers + Verdict (Ship/Fix/Rethink).

### Flow

1. **Read screenshots** from manifest at `/tmp/design-review/{feature}/manifest.md`.
2. **Read page context** from `.pm/dev-sessions/{slug}.md` (or legacy `.dev-state-*.md`).
3. **Read CLAUDE.md** design principles from the project root.
4. **Dispatch design reviewer** per `${CLAUDE_PLUGIN_ROOT}/skills/design-critique/references/reviewer-prompt.md`. The reviewer receives: all screenshots (via Read tool), manifest, enriched artifacts (a11y snapshots, consistency audit), CLAUDE.md design principles, ticket context.
5. **Dispatch Fresh Eyes reviewer** per `${CLAUDE_PLUGIN_ROOT}/skills/design-critique/references/fresh-eyes-prompt.md`. Run in parallel with the primary reviewer when the runtime supports delegation.
6. **Merge findings.** Deduplicate overlapping findings between the reviewer and Fresh Eyes. Keep the better-written version. Prioritize: P0 (blocks users) > P1 (degrades experience) > P2 (polish). If both flag the same issue, that's a strong signal — keep it.
7. **Return** merged findings + verdict to the calling agent.

### Verify Mode (re-invocation after fixes)

Same flow, with these differences:

- The design reviewer also receives the previous round's findings for comparison.
- Fresh Eyes still gets zero context. It never sees prior findings.

---

## Standalone Mode Flow

Full self-contained flow for when there is no implementing agent.

1. **User provides:** app path, page/screen, description.
2. **Platform detection** per `${CLAUDE_PLUGIN_ROOT}/skills/design-critique/references/capture-guide.md`.
3. **Engineer worker:**
   a. Create seed task if none exists (per `${CLAUDE_PLUGIN_ROOT}/skills/design-critique/references/seed-conventions.md`).
   b. Start servers (per `${CLAUDE_PLUGIN_ROOT}/skills/design-critique/references/capture-guide.md`).
   c. Run seed, capture screenshots to `/tmp/design-review/{feature}/`, write manifest.
   d. Capture enriched artifacts (a11y snapshots, consistency audit) per capture-guide.md.
4. **Design reviewer** examines screenshots + enriched data.
5. **Fresh Eyes** examines screenshots with zero context.
6. **Merge findings.**
7. **Engineer fixes** P0 and P1 findings.
8. **Re-capture, re-review** if P0s were found. Max 2 rounds total.
9. **Final report** written to `/tmp/design-review/{feature}/final-report.md`.
10. **Commit changes.**

---

## Reviewer Dispatch

Read `agent-runtime.md` before dispatching any reviewer or worker.

- Design reviewer: `pm:design-reviewer`
- Fresh Eyes: `general-purpose` with zero prior findings context
- Engineer (standalone mode only): persistent worker `general-purpose`

In Claude or Codex-with-delegation:
- Run design reviewer and Fresh Eyes in parallel
- Keep the standalone engineer as a persistent worker when fixes are needed

In Codex without delegation:
- Run the reviewer brief inline
- Run Fresh Eyes inline with zero-context isolation
- Perform standalone engineer steps in the main context

### What the design reviewer receives

- All screenshots (read via Read tool)
- The manifest from `/tmp/design-review/{feature}/manifest.md`
- Enriched artifacts: a11y snapshots, consistency audit
- CLAUDE.md design principles
- Ticket/page context
- Previous round findings (verify mode only)

### What Fresh Eyes receives

- All screenshots (read via Read tool)
- Brief: page description, target persona, job to be done
- CLAUDE.md design principles
- **Nothing else.** No prior findings, no round history, no reviewer reports.

---

## Finding Merge (inline step, not an agent)

After both the design reviewer and Fresh Eyes return:

1. **Deduplicate:** Identify findings that describe the same issue. Keep the better-written version with higher confidence.
2. **Resolve contradictions:** If findings conflict, the one backed by data (`[HIGH]`) wins. If both are `[MEDIUM]`/`[LOW]`, note both perspectives.
3. **Order by priority:** P0 > P1 > P2.
4. **Compute verdict:**
   - **Ship** — No P0s or P1s remaining
   - **Fix** — P0s or P1s need attention
   - **Rethink** — Fundamental issues that can't be fixed incrementally

This is a simple merge, not a separate agent dispatch.

---

## Final Report Format

```markdown
# Design Review Report

**Feature:** {feature}
**Platform:** {web/mobile}
**Rounds:** {N}
**Date:** {date}

## Verdict
{Ship / Fix / Rethink}

## Findings

### Resolved
{findings fixed during iteration}

### Remaining
{P2 items deferred to backlog}
```

---

## Critical Rules

1. **Findings merge is inline.** Deduplication and prioritization happen in the orchestrator, not a separate agent.
2. **Fresh Eyes NEVER receives prior context.** No prior findings, no round history, no reviewer reports.
3. **Screenshots come from real running apps.** NEVER from Storybook.
4. **Seed data from rake tasks.** NEVER from MSW mocks.
5. **Max 10 screenshots per capture round.**
6. **Max 2 iteration rounds.** Second round only if P0s remain after first fix pass.
7. **In embedded mode, return findings only.** Do NOT fix issues. The implementing agent does that.
8. **Data first.** The reviewer must process a11y snapshots and consistency audit before visual screenshot analysis. Provable findings take priority over visual guesses.
