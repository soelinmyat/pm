---
type: backlog-issue
id: PM-003
title: "Engineering Manager Feasibility Review"
outcome: "During grooming, an EM persona agent scans the codebase and counsels the user on technical feasibility — surfacing what exists, what's missing, and what's risky before the ticket is finalized"
status: drafted
parent: "prd-grade-output"
children: []
labels:
  - "output-quality"
  - "grooming"
  - "differentiation"
priority: high
research_refs:
  - pm/research/prd-grade-output/findings.md
created: 2026-03-13
updated: 2026-03-13
---

## Outcome

During grooming, an Engineering Manager persona scans the codebase and counsels the user on technical feasibility. The EM reviews the scoped feature against the actual code, identifies what infrastructure exists, what needs to be built, and what risks are hidden. This extends Phase 4.5 into a three-agent review: Product Manager, Competitive Strategist, and Engineering Manager.

## Acceptance Criteria

1. The groom skill dispatches an EM persona agent (during or after Phase 4.5) that reads the relevant codebase and the scoped feature
2. The EM agent reviews from these angles:
   - **Build-on:** What existing code, patterns, or infrastructure supports this feature?
   - **Build-new:** What doesn't exist yet and would need to be created?
   - **Risk:** What makes this harder than it looks? (missing dependencies, architectural constraints, performance concerns)
   - **Sequencing advice:** What should be built first? Are there natural implementation milestones?
3. The EM presents findings conversationally to the user, inviting discussion
4. The user can ask follow-up questions or push back on the EM's assessment
5. After the conversation, the EM's key findings are captured in a `## Technical Feasibility` section in the groomed ticket, referencing specific file paths
6. Feasibility language is observational ("the codebase currently has X") not prescriptive ("implement it with Y") — stays on the PM side of non-goal #1
7. If no codebase is available (greenfield project), the section notes "No codebase context available" and falls back to research-based feasibility signals

## Competitor Context

No competitor has codebase context. ChatPRD, Productboard Spark, and PM Skills Marketplace all generate specs blind to the implementation reality. An EM who actually reads the code before counseling on feasibility is uniquely possible because PM lives inside the editor.

## Research Links

- [PRD-Grade Groomed Output Research](pm/research/prd-grade-output/findings.md) — Finding 7 (the gap is integration, not generation)

## Notes

- The EM persona is opinionated but observational — it tells you what the code says, not what to do about it
- This is the strongest differentiation claim: no other PM tool can ground its specs in the actual codebase
- The interactive counsel format (not a static dump) lets users probe deeper on specific risks
- Phase 4.5 becomes: PM reviewer (product), Competitive Strategist (market), EM (technical) — a three-lens review
