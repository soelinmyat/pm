---
type: backlog-issue
id: "PM-034"
title: "Readable Output Foundation: Style Guide + Terminal Formatting Rules"
outcome: "Users can scan every terminal message in under 5 seconds — verdicts lead, bullets replace paragraphs, and jargon is replaced with plain language"
status: done
parent: null
children:
  - "scannable-proposal-template"
labels:
  - "output-quality"
  - "infrastructure"
priority: high
research_refs:
  - pm/competitors/index.md
created: 2026-03-20
updated: 2026-03-20
---

## Outcome

After this ships, every terminal message the PM plugin produces follows a consistent style: verdict or action first, then 1-3 short bullets, then an optional "Want more detail?" offer. Paragraphs of analysis are replaced with scannable summaries. Jargon like "decomposition methodology" becomes "how to split the feature." The user no longer skips reading output because it's exhausting — they absorb the key point in a glance.

## Acceptance Criteria

1. A new reference file exists at `skills/groom/references/style-guide.md` containing:
   - Readability target: Flesch-Kincaid grade ≤8 (age 13-14)
   - Max sentence length: 20 words
   - Max paragraph length: 2 lines
   - Bullets over prose: always prefer a list of 1-3 items over a paragraph
   - Jargon ban list with plain alternatives (e.g., "decomposition" → "splitting", "acceptance criteria" → "done-when checklist", "feasibility" → "can we build this?")
   - Before/after examples showing dense output rewritten as scannable output
   - "Ask one thing, say one thing" as the governing principle
2. `skills/groom/SKILL.md` contains a new "Output Formatting" section (near the top, after Interaction Pacing) with these rules:
   - **Verdict first:** Every terminal message to the user starts with the conclusion, decision, or action — not the reasoning
   - **Max 3 bullets before interaction:** If more context exists, end with "Want more detail?" and expand only if asked
   - **No walls of text:** Never produce more than 3 consecutive lines of prose without a break (bullet, heading, or user interaction)
   - **Parallel agent output collapsing:** When presenting results from multiple review agents, show a summary table (reviewer | verdict | one-line note) first. Detail only on request.
   - **Read the style guide:** All output-facing text must follow `skills/groom/references/style-guide.md`
3. The style guide includes at least 3 before/after examples drawn from real groom session output:
   - Scope review presentation (before: 3 dense paragraphs → after: verdict + 3 bullets)
   - Team review summary (before: per-agent walls of text → after: summary table + "want detail?")
   - Strategy check result (before: multi-sentence analysis → after: "Aligned with Priority #2. No conflicts.")
4. The SKILL.md formatting rules reference the style guide via a single `Read ${CLAUDE_PLUGIN_ROOT}/skills/groom/references/style-guide.md` instruction placed in the Custom Instructions section, immediately after the existing instructions load block (lines 51-57), so it loads at session start alongside team instructions.
5. Total new content in SKILL.md does not exceed 20 lines. The style guide reference file carries the detail.
6. The style guide reference file does not exceed 80 lines — concise enough to avoid context window pressure, with the most important rules (verdict first, max 3 bullets, no walls of text) in the first 10 lines.

## User Flows

N/A — no user-facing workflow for this feature type.

## Wireframes

N/A — no user-facing workflow for this feature type.

## Competitor Context

No competitor constrains AI output to a readability standard. ChatPRD recognized this pain — their users complained about verbose output, and ChatPRD responded in December 2025 by adding a verbosity toggle (concise/balanced/detailed). That's a user-controlled bandaid. PM solves it structurally: formatting rules enforced at the prompt layer, not a toggle the user manages. PM Skills Marketplace and Productboard Spark produce dense output with no readability controls at all. PM's "grade 8 by design" standard is unclaimed positioning territory.

## Technical Feasibility

**Feasible as scoped.** `skills/groom/references/` directory already exists (splitting-patterns.md). SKILL.md already has an "Interaction Pacing" section that this parallels. The `pm/instructions.md` hook in SKILL.md (lines 51-57) already reads shared instructions — the style guide slots into the same pattern.

**Risk:** Style guide is a prompt instruction, not a mechanical guard. If context pressure causes the LLM to skip the Read instruction, output reverts to default density. Mitigation: keep the style guide concise (<80 lines) and front-load the most important rules.

## Research Links

- Web: UK gov.uk plain language standard (reading age 9)
- Web: CLI Guidelines (clig.dev) — "human-readable output is paramount"
- Web: Dashboard design patterns — "wall of data" anti-pattern
- Plugin analysis: superpowers brainstorming — visual companion pattern

## Notes

- The jargon ban list should be treated as advisory, not absolute — some terms (like "acceptance criteria") are standard in PM tooling and may need context-dependent handling.
- Success metric: observe whether users engage with "Want more detail?" prompts (engagement signal) and whether review iterations decrease over 5 sessions.
- **Follow-up:** Consider adding "Grade 8 by design" to pm/strategy.md Section 3 as a positioning line — bar raiser flagged this as a positioning decision that should be validated in practice first, not shipped as an implementation AC.
