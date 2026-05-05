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
{For UI features with a prototype, link to the wireframe entry point:
- Single-file: `[Prototype]({pm_dir}/backlog/wireframes/{slug}.html)`
- Multi-file (3+ screens): `[Prototype]({pm_dir}/backlog/wireframes/{slug}/index.html)`

The proposal HTML renderer (Step 7) reads the wireframe's metadata
(per `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/prototype-format.md` §6)
to auto-populate the screens caption under the hero prototype figure.

For non-visual features: "No wireframes — feature is non-visual." Omit the section entirely from the rendered HTML.}

## Competitive Context
{For each relevant competitor: do they already have this feature? If yes, describe how they
handle it. If no, note "not offered."

Markdown comparison table (capability | competitor | their approach | our approach).
Blockquote for key differentiator.

**Handling decision:** {Restate the 10x filter result from Scope and explain the rationale —
why are we handling it this way given what competitors already do?
- `10x`: what makes our approach meaningfully better than theirs?
- `gap-fill`: what gap are we closing in their implementation?
- `table-stakes`: baseline expectation; no differentiation claim needed.
- `parity`: intentionally matching {competitor} — state the explicit strategic reason.}}

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

## Success Metrics
{Leading indicators for 90-day success. Not lagging metrics like revenue.

| Metric | Baseline | Target | Timeframe |
|--------|----------|--------|-----------|
| {metric} | {current} | {goal} | {days} |
}

## Next Steps
Ready for engineering? Run `pm:rfc {slug}` to generate the technical RFC, then `pm:dev {slug}` to implement.
```

## Status Lifecycle

| Status | Set by | Meaning |
|--------|--------|---------|
| `idea` | `pm:ideate` | Early-stage idea from KB mining, not yet groomed |
| `drafted` | `pm:groom` (draft-proposal) | Proposal assembled, under review |
| `proposed` | `pm:groom` (present/finalize) | Product-approved, awaiting engineering |
| `planned` | `pm:rfc` | RFC exists and approved, ready to build |
| `in-progress` | `pm:dev` | Implementation underway |
| `done` | `pm:dev` / `pm:ship` | All work shipped |

---

## Agent-tier source citations (PM-233)

Proposals produced by `groom_tier: agent` carry mandatory inline source citations on every derived decision. The citations live in three layers:

1. **State** — `source_citations:` block at session-state level (already in `state-schema.md`); also inline `source:` field on each scope item, persona, JTBD, edge case, risk in the synthesizer's output.
2. **Markdown proposal** — flattened to `[source: path#L42]` or `[source: path#F3]` notation, inline next to the cited claim. Example:
   ```markdown
   ## JTBD
   When I groom a feature with KB-rich context, I want to skip questions about
   facts already documented [source: pm/strategy.md#L24], so I can review a
   complete proposal in one pass [source: pm/evidence/research/agent-mode-pm-tools.md#F2].
   ```
3. **HTML proposal** — small `<sup class="src">path#L42</sup>` superscript next to each cited claim, plus a collapsed `<details class="audit-block">` "Citation audit" block at the end of the proposal listing every citation in structured form.

### Citation field shape

Per RFC §5.2 (PM-233), citations are structured objects, not strings:

```yaml
source:
  file: "pm/evidence/research/agent-mode-pm-tools.md"
  line: 42                                # nullable
  finding_id: "F3"                        # nullable; for evidence files with finding markers
  excerpt: "Spark sells output, not process"   # nullable; reviewer-aid
```

State stores the structured object. Markdown render flattens to one of:
- `[source: path#L<line>]` if line is set
- `[source: path#<finding_id>]` if finding_id is set
- `[source: path]` if neither (file-level citation only)

HTML render emits the same string inside `<sup class="src">`. The audit `<details>` block at the end of the HTML lists the full structured form (file, line, finding_id, excerpt) for each citation. Audit block is collapsed by default; readers expand it to verify a specific claim.

### Citation count parity rule

The HTML proposal MUST contain at least as many `<sup class="src">` tags as the markdown contains `[source: ...]` tokens. Lower count = citation loss between layers (a real risk acknowledged in RFC §8 Risks). The 07-draft-proposal step's agent-tier subsection enforces parity by counting citations in the markdown source before HTML render and asserting the count is preserved.

### When this applies

Citations are **mandatory** for `groom_tier: agent`. Co-pilot tiers (quick / standard / full) MAY include citations but it is not required — the existing co-pilot 07-draft-proposal flow does not produce inline `[source: ...]` tokens. Step 07's "Agent-tier additions" subsection is the only place where citation rendering runs; co-pilot tiers skip it cleanly.
