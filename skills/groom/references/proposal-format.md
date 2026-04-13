# Proposal Format (Backlog Entry)

## Contract

The final output is a single `type: backlog` document at `{pm_dir}/backlog/{topic-slug}.md`.

- **Schema authority:** `${CLAUDE_PLUGIN_ROOT}/references/frontmatter-schemas.md` defines all allowed frontmatter fields and enum values. No step may redefine status values, required fields, or section names.
- **This file** provides the body section template and worked example.

No other step may contradict the schema. If a conflict is found, the schema wins.

## ID Assignment

When an issue tracker is available (Linear) and a Linear issue is created or already exists for this proposal, use the Linear identifier as the local `id` (e.g., `PM-123`). Do NOT generate a separate local sequence — the Linear ID is the single source of truth. Only fall back to the local `PM-{NNN}` sequence (scan `{pm_dir}/backlog/*.md` for highest `id`, increment by 1, zero-pad to 3 digits, first entry `PM-001`) when no issue tracker is configured.

## Template

```markdown
---
type: backlog
id: "{linear_id or PM-NNN}"
title: "{Feature Title}"
outcome: "{One-sentence: what changes for the user when this ships}"
status: drafted
priority: critical | high | medium | low
labels:
  - "{label}"
prd: null
rfc: null
linear_id: "{Linear ID}" | null
thinking: thinking/{topic-slug}.md | null
research_refs:
  - {pm_dir}/evidence/research/{topic-slug}.md
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

## Outcome
{Expand on the outcome statement. What does the user experience after this ships?
What were they unable to do before?}

## Problem & Context
{The user pain, market signal, or strategic driver. Use blockquotes for key research signals.}

## Scope
In-scope:
- {item}

Out-of-scope:
- {item}: {reason}

10x filter result: {10x | gap-fill | table-stakes | parity}

## User Flows
{Mermaid diagrams in fenced code blocks. Include %% Source: citations.}

## Wireframes
{Link to wireframe HTML files: [Wireframe]({pm_dir}/backlog/wireframes/{name}.html).
Or "No wireframes — feature is non-visual."}

## Competitive Context
{Markdown comparison table (capability | competitors | our approach).
Blockquote for key differentiator.}

## Technical Feasibility
{EM assessment from scope review. Verdict: feasible | feasible-with-caveats | needs-rearchitecting.
Build-on, build-new, risks, sequencing.}

## Review Summary
{Pipeline steps completed. Verdict summary. Advisory notes.}

## Resolved Questions
{Each question from reviewers with its answer and evidence.
If any remain, list under **Decisions Needed** with a recommended answer.}

## Freshness Notes
{Only if stale research exists. Otherwise omit this section entirely.
Format: "'{name}' — {age_days} days old (threshold: {threshold_days}d for {type})."}

## Next Steps
Ready for engineering? Run `pm:dev {slug}` to generate the RFC and begin implementation.
```

## Status Lifecycle

| Status | Set by | Meaning |
|--------|--------|---------|
| `idea` | `pm:ideate` | Early-stage idea from KB mining, not yet groomed |
| `drafted` | `pm:groom` (draft-proposal) | Proposal assembled, under review |
| `proposed` | `pm:groom` (present/finalize) | Product-approved, awaiting engineering |
| `planned` | `pm:dev` | RFC exists and approved, ready to build |
| `in-progress` | `pm:dev` | Implementation underway |
| `done` | `pm:dev` / `pm:ship` | All work shipped |
