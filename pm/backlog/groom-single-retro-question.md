---
type: backlog-issue
id: "PM-063"
title: "Reduce groom retro to a single question"
outcome: "Users finish groom sessions without unnecessary ceremony — one retro question instead of three"
status: approved
parent: null
children: []
labels:
  - "developer-experience"
  - "process"
priority: medium
research_refs: []
created: 2026-03-22
updated: 2026-03-22
---

## Outcome

After this ships, the groom retro in Phase 6 asks a single open-ended question ("Any feedback on this session?") instead of three sequential questions. Users who want to share more can; users who want to move on say "no" once and they're done.

## Acceptance Criteria

1. Phase 6 (`phase-6-link.md`) step 6 asks one question: "Any feedback on this session?" instead of three separate questions.
2. If the user provides feedback, save it as a single entry to `pm/memory.md` with `source: retro` and `category: process`.
3. If the user skips ("no", "skip", "none", "n/a"), no entry is written.
4. The automated learning extraction (step 7) remains unchanged.

## User Flows

N/A — minor process change within existing groom flow.

## Wireframes

N/A — no UI component.

## Competitor Context

N/A — internal process improvement.

## Technical Feasibility

**Verdict: Feasible as scoped.** Single file change to `skills/groom/phases/phase-6-link.md` — replace the 3-question retro block with a single question.

## Research Links

None.

## Notes

- Motivated by repeated retro feedback that 3 questions at the end of a long groom session feels like too much ceremony.
