# Proposal Format (Backlog Entry)

Write the proposal entry to `{pm_dir}/backlog/{topic-slug}.md`. This is the parent backlog item — the PRD content is inline, and it links to the RFC when one exists.

**ID assignment:** When an issue tracker is available (Linear) and a Linear issue is created or already exists for this proposal, use the Linear identifier as the local `id` (e.g., `PM-123`). Do NOT generate a separate local sequence — the Linear ID is the single source of truth. Only fall back to the local `PM-{NNN}` sequence (scan `{pm_dir}/backlog/*.md` for highest `id`, increment by 1, zero-pad to 3 digits, first entry `PM-001`) when no issue tracker is configured.

```markdown
---
id: "{linear_id or PM-NNN}"
title: "{Feature Title}"
outcome: "{One-sentence: what changes for the user when this ships}"
status: proposed | in-progress | done
prd: null
rfc: rfcs/{topic-slug}.html | null
linear_id: "{Linear ID}" | null
thinking: thinking/{topic-slug}.md | null
priority: critical | high | medium | low
labels:
  - "{label}"
research_refs:
  - {pm_dir}/evidence/research/{topic-slug}.md
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

## Outcome

{Expand on the outcome statement. What does the user experience after this ships?
What were they unable to do before?}

## Scope

In-scope:
- {item}

Out-of-scope:
- {item}: {reason}

## Competitor Context

{How do competitors handle this? Where do they fall short?
Reference specific profiles from {pm_dir}/evidence/competitors/ if applicable.}

## Technical Feasibility

{Engineering Manager assessment from scope review.
Verdict: feasible | feasible-with-caveats | needs-rearchitecting.}

## Research Links

- [{Finding title}]({pm_dir}/evidence/research/{topic-slug}.md)

## Notes

{Deferred scope items. Resolved questions from review (if any remain as decisions needed, list them here with recommended answers).}
```

## Status Lifecycle

- `proposed` — PRD exists, no RFC yet. Product-approved, awaiting engineering planning.
- `planned` — RFC exists and approved. Ready to build.
- `in-progress` — Dev is implementing from the RFC.
- `done` — All RFC issues shipped.

**Verdict** is set by groom and never changed by dev. **Status** is updated by dev as implementation progresses.
