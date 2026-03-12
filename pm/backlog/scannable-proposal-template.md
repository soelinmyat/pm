---
type: backlog-issue
id: "PM-035"
title: "Scannable Proposal Template: Glanceable HTML with One-Sentence Summaries"
outcome: "Users opening a proposal in the browser grasp the key decision — what, why, and whether to approve — within 10 seconds, without scrolling past the first screen"
status: done
parent: "readable-output-foundation"
children: []
labels:
  - "output-quality"
  - "infrastructure"
priority: high
research_refs:
  - pm/research/prd-grade-output/findings.md
  - pm/competitors/index.md
created: 2026-03-20
updated: 2026-03-20
---

## Outcome

After this ships, the proposal HTML that opens at the end of a groom session is designed for scanning, not reading. Each section opens with a one-sentence summary. Content is in small chunks. The hero header tells you what to decide. The issue cards show outcomes, not walls of ACs. A user can approve or request changes after 10 seconds of scanning — because the structure makes the decision obvious.

## Acceptance Criteria

1. The proposal reference template at `skills/groom/templates/proposal-reference.html` is rewritten for scannability (verify current state — the file may exist but lack the scannability patterns below; if missing, create it). This is the single source of truth that every future proposal inherits from.
2. Every section in the template opens with a **one-sentence summary** in a callout or bold line before any detail. Examples:
   - Problem: "The drafter produces dense output that users skip reading."
   - Scope: "6 items in, 5 items out. This is a 10x differentiator."
   - Issues: "2 issues, both high priority, ready after 2 review rounds."
3. The issue cards section shows: ID badge, title, outcome (one line), and label badges. Acceptance criteria are collapsed by default with a "Show ACs" toggle (CSS-only, no JS required — use `<details><summary>` elements).
4. Proposal sections use a max content width of 65ch for body text (optimal reading line length).
5. Whitespace between sections is increased by 50% compared to current proposals.
6. The competitive comparison table uses color-coded cells (green for PM advantages) with short phrases, not sentences.
7. The review summary section uses the existing pipeline stepper + verdict badge cards — but each card's note is capped at one line (currently unlimited).
8. The template follows the style guide from PM-034 if available, or plain language principles if PM-034 hasn't shipped yet.
9. `phase-5.8-present.md` instructions are updated to reference the new template and include a "scannability check" step: before opening the proposal, verify each section summary is one sentence max.

## User Flows

N/A — no user-facing workflow for this feature type.

## Wireframes

N/A — no user-facing workflow for this feature type.

## Competitor Context

No competitor produces scannable proposal output. ChatPRD generates long-form PRD text — their users complained about verbosity, leading to a concise/balanced/detailed toggle in Dec 2025, which still produces paragraph-heavy output. Productboard Spark users cite "overwhelming interface" as a top complaint (sentiment data). PM Skills Marketplace produces session-scoped text with no persistent structure at all. PM's proposal template is already structurally ahead (HTML with sections, pipeline stepper, verdict badges) — this issue makes it ahead in readability too, with collapsible ACs and one-sentence section leads that no competitor offers.

## Technical Feasibility

**Feasible as scoped.** The proposal HTML pattern is well-established — `pm/backlog/proposals/*.html` files exist with full CSS. The `<details><summary>` pattern for collapsible ACs is pure HTML/CSS with no JS dependency. The missing `proposal-reference.html` is a silent bug that this issue fixes.

**Risk:** The template is an instruction to the LLM ("replicate this reference"), not a mechanical template engine. If the LLM deviates, the scannability guarantees break. Mitigation: the scannability check step in phase-5.8 catches deviations before the user sees them.

## Research Links

- pm/research/prd-grade-output/findings.md — visual artifacts and output quality research
- Web: Dashboard design — "lead with key data in scannable cards"
- Web: F-pattern and Z-pattern reading layouts

## Notes

- The `<details><summary>` pattern for ACs is a significant UX improvement — users who need AC detail can expand, users who just need the verdict can skip.
- Fixing the missing proposal-reference.html is high-leverage: every future groom session inherits from it.
