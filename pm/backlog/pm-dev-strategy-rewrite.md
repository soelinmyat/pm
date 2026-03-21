---
type: backlog-issue
id: "PM-045"
title: "Rewrite strategy.md for product engineer positioning"
outcome: "Strategy document reflects the merged plugin's identity: a workflow optimization tool for product engineers, with updated goals, non-goals, and competitive positioning."
status: done
parent: "pm-dev-merge"
children: []
labels:
  - "strategy"
  - "product-engineer"
priority: high
research_refs:
  - pm/research/pm-dev-merge/findings.md
created: 2026-03-21
updated: 2026-03-21
---

## Outcome

The strategy document becomes the source of truth for the merged plugin's direction. Anyone reading it understands: this tool serves the product engineer's end-to-end workflow, from idea to shipped code. The old boundary ("PM ends at the groomed ticket") is replaced with a role-based boundary.

## Acceptance Criteria

1. Product Identity (Section 1) updated: "Structured workflows for the product engineer, on top of whatever AI coding assistant they already use."
2. ICP (Section 2) updated: primary ICP is the product engineer — named explicitly with market evidence (Anthropic/Cat Wu quote on role blurring, ~$165K avg US comp signal, Gibson Consultants March 2026 convergence trend). Technical founders, small-squad builders who own both product decisions and implementation.
3. Value prop (Section 3) updated to reflect three goals: build valuable products, build efficiently, manage cognitive load.
4. Competitive positioning (Section 4) updated with differentiated stance: Compound Engineering's deliberate PM exclusion and Kiro's spec-blindness named as the gap this tool closes. No competitor offers integrated research→grooming→implementation→merge pipeline.
5. Non-Goal #1 replaced: "Not an AI model, coding platform, or infrastructure tool. Workflow optimization layer for product engineers. Does not serve platform engineering, infrastructure operations, or production incident management."
6. Non-Goal #2 reframed: "Not an enterprise project management tool. No sprint planning, velocity tracking, capacity management, approval workflows, or role-based access control. Small teams share context through the repo — scales to the squad, not the org."
7. Success metrics updated to include: groomed issues completing in fewer steps, one-session shipping rate.
8. Audit existing backlog items (pm/backlog/*.md) for alignment with updated strategy. Flag any that conflict with new goals or non-goals. Issues groomed under old Non-Goal #1 ("PM ends at the groomed ticket") may now have outdated scope boundaries.

## User Flows

N/A — no user-facing workflow for this feature type.

## Wireframes

N/A — no user-facing workflow for this feature type.

## Competitor Context

PM currently positions against Productboard Spark, Crayon/Klue, and general AI prompts. The merged plugin adds a new competitor axis: dev lifecycle tools (Compound Engineering, Kiro, MetaGPT). None of these do upstream PM work. The strategy rewrite must articulate this expanded competitive landscape.

## Technical Feasibility

Single file edit to `pm/strategy.md`. No code changes. However, this is a foundational document — all grooming phases check strategy alignment. The rewrite must be internally consistent so future `/pm:groom` strategy checks validate correctly against the new goals and non-goals.

## Research Links

- [PM-Dev Merge Research](pm/research/pm-dev-merge/findings.md)

## Notes

- Must be done first — all subsequent issues reference the updated strategy for alignment.
- The "product engineer" persona should be named explicitly for SEO and content marketing value (~$165K avg US comp, growing role per multiple sources).
