---
type: backlog-issue
id: "PM-061"
title: "Per-phase companion screens for groom sessions"
outcome: "Users with the visual companion see a rich, formatted summary of each groom phase as it completes — scope grids, review verdict tables, issue previews — instead of a generic state dump"
status: drafted
parent: "groom-visual-companion"
children: []
labels:
  - "output-quality"
  - "feature"
priority: high
research_refs:
  - pm/research/groom-visual-companion/findings.md
created: 2026-03-22
updated: 2026-03-22
---

## Outcome

After this ships, groom phases 4 through 5.8 each write a self-contained HTML file to `.pm/sessions/groom-{slug}/current.html` that summarizes the phase's key output in scannable format. The browser auto-refreshes via WebSocket and shows a view that is meaningfully richer than the terminal — formatted tables, scope grids, verdict summaries, and issue previews. Non-visual phases (1-3, 6) show a "Phase in progress..." placeholder.

## Acceptance Criteria

1. Phase 4 (Scope) writes a `current.html` containing: in-scope items, out-of-scope items with reasons, and the 10x filter result. Formatted as a two-column grid (in/out) with the filter result as a badge.
2. Phase 4.5 (Scope Review) writes a `current.html` containing: the reviewer verdict table (PM, Competitive, EM), blocking issues as a numbered list, and advisory items collapsed below.
3. Phase 5 (Groom) writes a `current.html` containing: the decomposition table (pattern, fit, verdict), issue preview cards with title and outcome, and the Mermaid user flow diagram. Mermaid diagrams are included as fenced code blocks with a client-side Mermaid.js `<script>` tag for rendering (not server-side `renderMarkdown()`).
4. Phase 5.5 (Team Review) writes a `current.html` containing: the reviewer verdict table (PM, Competitive, EM, Design), blocking issues, and iteration count.
5. Phase 5.7 (Bar Raiser) writes a `current.html` containing: the verdict, conditions, and iteration count.
6. Phase 5.8 (Present) writes a `current.html` containing: a link to the full HTML proposal file and a summary of the session (phases completed, issues drafted, total review iterations).
7. Non-visual phases (1, 2, 3, 6) write a placeholder `current.html` with: "Phase {N}: {label} — in progress" and a phase stepper showing completed phases with checkmarks and upcoming phases greyed out.
8. A companion screen HTML template is defined in `skills/groom/references/companion-template.md`. All 6 phase write steps and the placeholder template reference this template for consistent structure: topic name as header, phase stepper at top, content area below, and "Powered by PM" footer. Inline CSS only — no external dependencies except a Mermaid.js CDN `<script>` for diagram rendering.
9. The phase stepper shows completed phases with a checkmark and past-tense label (e.g., "Scope defined"), the current phase with a present-continuous label (e.g., "Reviewing scope..."), and upcoming phases greyed out. This follows the Evil Martians "gerund-to-past-tense" pattern for perceived responsiveness.
10. Every companion screen must contain at least one element not available in the terminal output — a formatted table, a rendered diagram, a scope grid, or a phase stepper. A screen that simply mirrors terminal text is a bug.
11. The HTML write step is conditional on `visual_companion: true` in `.pm/config.json`. If false or unset, no file is written.
12. Each phase overwrites `current.html` (not accumulated). The browser shows only the current phase's output.

## User Flows

N/A — this is a content generation feature within the groom workflow, not a separate user flow.

## Wireframes

N/A — companion screens are generated dynamically per phase, not designed as static wireframes. The template structure (header, stepper, content, footer) is defined in the ACs above.

## Competitor Context

No competitor generates per-phase visual summaries during product grooming. ChatPRD outputs a single PRD document at the end. Productboard Spark shows conversation in a chat UI. MetaGPT X visualizes agent orchestration workflows but targets inter-agent communication, not structured product grooming output — the content model is fundamentally different. PM's phase-by-phase rendering with auto-updating browser is unique — it follows the checklist/stepper pattern that Evil Martians research identifies as the expected UX for multi-phase CLI processes.

## Technical Feasibility

**Verdict: Feasible as scoped.**

**Build-on:**
- `scripts/server.js:284` — `renderMarkdown()` handles headings, lists, tables, code blocks, and Mermaid diagrams. Phase content can be rendered through this pipeline.
- `scripts/server.js:1206` — `GROOM_PHASE_LABELS` provides human-readable labels for the phase stepper.
- `skills/groom/phases/phase-5-groom.md` — Phase 5 already generates wireframe HTML files, demonstrating the pattern of LLM-authored HTML during grooming.
- `scripts/server.js:428` — `DASHBOARD_CSS` provides the design vocabulary (cards, badges, tables, layout) for consistent styling.

**Build-new:**
- A companion screen template (HTML/CSS) reusable across all 6 visual phases. Includes header, phase stepper, content slot, and footer.
- A write step added to each of the 6 phase files (`phase-4-scope.md`, `phase-4.5-scope-review.md`, `phase-5-groom.md`, `phase-5.5-team-review.md`, `phase-5.7-bar-raiser.md`, `phase-5.8-present.md`).
- A placeholder template for non-visual phases (1-3, 6).

**Key risk:** Per-phase HTML quality depends on LLM output consistency. Mitigation: write step at the top of each phase (before heavy work, using prior phase's output), not at the end. If context pressure causes a skip, the route handler falls back to the rendered state file (PM-060 AC2).

**Sequencing:** Requires PM-060 (session route) to be completed first. The route's `current.html` override (PM-060 AC2) is the integration point.

## Research Links

- [Groom Visual Companion Patterns](pm/research/groom-visual-companion/findings.md)

## Notes

- The phase stepper (AC7-8) is the key UX element that makes the browser richer than the terminal. It shows progress across the entire groom lifecycle at a glance.
- Decomposition rationale: Workflow Steps pattern — this is the second step (groom skill writes content to session pages). Depends on PM-060 for the serving infrastructure.
- The template should follow the style guide from PM-034: one-sentence summary at top, bullets not prose, max 3 content blocks per screen.
