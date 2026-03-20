---
type: backlog-issue
id: "PM-032"
title: "Groom Phase 5: Add Decomposition Methodology with Splitting Patterns"
outcome: "PMs receive an issue set with visible decomposition reasoning — the drafter shows which splitting patterns it considered and why it chose one — so they can catch structural problems before engineering picks up the work, rather than discovering them mid-sprint"
status: done
parent: null
children:
  - "groom-invest-dependency-gate"
labels:
  - "grooming-quality"
  - "infrastructure"
priority: high
research_refs:
  - pm/competitors/index.md
created: 2026-03-20
updated: 2026-03-20
---

## Outcome

After this ships, PMs see the reasoning behind issue decomposition — not just the output. Phase 5 no longer jumps from scope to template-filling. Instead, the drafter shows the PM 2-3 candidate decomposition approaches (e.g., "CRUD split vs. workflow-step split"), evaluates each against the project's accumulated context (research findings, scope constraints, EM feasibility notes), and explains why it chose one. The PM can catch structural problems — like horizontal slicing or missing vertical value delivery — before engineering picks up the work, rather than discovering them mid-sprint during Phase 5.5 review.

This is the grooming equivalent of "show your work" — the decomposition reasoning is grounded in the project's specific context, not generic patterns applied blindly.

## Acceptance Criteria

1. A new reference file exists at `skills/groom/references/splitting-patterns.md` encoding the 9 Humanizing Work splitting patterns (workflow steps, CRUD operations, business rule variations, data variations, data entry methods, major effort, simple/complex, defer performance, break out a spike) plus vertical slicing guidance and the meta-pattern ("find complexity, map variations, create single-variation slice").
2. Phase 5 contains a new Step 3 ("Decompose") inserted before the current issue drafting step. The step begins with an explicit `Read ${CLAUDE_PLUGIN_ROOT}/skills/groom/references/splitting-patterns.md` instruction to load the patterns reference at the right moment. The step instructs the drafter to: (a) identify 2-3 candidate decomposition approaches for the scoped feature, (b) evaluate each against the accumulated grooming context (research, scope, EM feasibility), (c) select one and state the rationale to the user.
2a. The user sees the eliminated decomposition approaches and the reason each was rejected, not just the chosen approach. This must be a visible interaction — the drafter presents all candidates with brief trade-off notes before proceeding with the selected one. This is the primary differentiator over stateless tools that generate one decomposition without alternatives.
3. The decomposition step includes a boundary quality test: "Can each resulting issue be understood without reading the others? Can one issue's implementation change without breaking another?" Issues that fail this test must be re-split.
4. MVP slicing guidance is woven into the decomposition step: for each candidate issue, ask "what's the thinnest vertical slice that delivers user value end-to-end?" with explicit instruction to slice vertically (through all layers) not horizontally (by technical component).
5. The decomposition step includes good/bad examples matching the quality standard established in `phase-5.5-team-review.md`:
   - BAD decomposition: "Issue 1: Build database schema. Issue 2: Build API. Issue 3: Build UI." (horizontal slice — no issue delivers user value alone)
   - BAD decomposition: "Issue 1: Implement the entire feature." (no decomposition at all)
   - GOOD decomposition: "Issue 1: Users can search by title (simplest query, end-to-end). Issue 2: Users can filter by date range (adds business rule variation). Issue 3: Users can combine filters (complex interaction)." (vertical slices, each independently valuable, ordered by complexity)
6. The decomposition rationale cites prior phase context — e.g., "Chose workflow-step split because EM review identified auth middleware as a separate concern" or "Research finding #2 shows competitors lack date filtering, so isolating it as a separate issue lets us validate the differentiator independently." If a prior phase output is unavailable (e.g., no EM feasibility review was conducted), the rationale states this explicitly rather than omitting the dimension.
7. Good/bad examples are also added for outcome statements and acceptance criteria in the issue drafting step (current Step 3, renumbered to Step 4), matching the BAD/GOOD pairs already present in `phase-5.5-team-review.md` lines 29-39.
8. Step numbering in `phase-5-groom.md` is updated consistently as part of this change: Step 1 (feature type), Step 2a/2b (visual artifacts), Step 3 (decompose — includes the `Read` instruction from AC 2), Step 4 (draft issues), Step 5 (update state). The renumbering and the `Read` instruction are implemented together to prevent step-label inconsistency.
9. The `references/` directory is created as a new directory under `skills/groom/` (distinct from the existing `templates/` which holds HTML files). This is a new namespace for instructional Markdown content.
10. Total new content in `phase-5-groom.md` does not exceed 150 lines (the file is currently 101 lines; the decomposition step adds ~40 lines, good/bad examples add ~15 lines, step renumbering overhead is minimal). The splitting patterns reference file is loaded on demand and does not count toward this budget.

## User Flows

N/A — no user-facing workflow for this feature type.

## Wireframes

N/A — no user-facing workflow for this feature type.

## Competitor Context

No editor-native PM tool provides structured decomposition methodology. Neither ChatPRD nor Productboard Spark surfaces decomposition alternatives — both generate a single decomposition without showing trade-offs. The superpowers brainstorming skill (dev-focused) uses a "2-3 approach proposals" pattern but doesn't do PM-specific issue grooming or apply story splitting patterns. PM Skills Marketplace's `user-stories` skill references INVEST but operates statelessly — it cannot ground decomposition in prior research or EM feasibility findings. PM is the only tool that chains strategy → research → groom into a stateful pipeline where decomposition decisions are grounded in accumulated project context (market gap #5 from competitive analysis).

## Technical Feasibility

**Feasible as scoped.** Phase 5 has a clean numbered step structure (Steps 1, 2a, 2b, 3, 4) that accepts insertion without restructuring. The `skills/groom/templates/` directory already holds reference files; a new `references/` directory follows the same pattern. The Phase 5.5 reviewer prompts already check decomposition quality (PM reviewer lines 44-51, EM reviewer lines 115-126), providing downstream validation. The reference file read pattern (`Read ${CLAUDE_PLUGIN_ROOT}/...`) is already established in `SKILL.md` line 90.

**Risk:** Context window growth. Phase 5 is already the heaviest phase with feature-type detection, Mermaid generation, wireframe generation, and issue drafting. The reference file adds ~80 lines of content that must be loaded. Mitigation: keep the decomposition step concise (~40 lines in phase-5-groom.md) and the reference file focused (~80 lines).

## Research Links

- Plugin analysis: superpowers brainstorming (2-3 approach proposals, design-for-isolation, boundary quality test)
- Plugin analysis: dev-epic (layer-aware decomposition, dependency ordering)
- Web: Humanizing Work Guide to Splitting User Stories (9 patterns)
- Web: Vertical slicing consensus (Visual Paradigm, Scrum.org)

## Notes

- The reference file path uses `references/` not `templates/` to distinguish instructional content from HTML templates.
- The EM sequencing recommendation puts this issue first in the build order — it is the structural core that all other improvements depend on.
- Advisory from scope review: examples should be drawn from realistic feature types (UI, API, infrastructure) not synthetic scenarios.
