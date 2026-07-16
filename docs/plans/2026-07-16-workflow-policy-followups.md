---
title: "Workflow policy follow-ups after semantic-integrity consolidation"
created: 2026-07-16
updated: 2026-07-16
status: proposed
---

# Workflow policy follow-ups

## Purpose

Keep judgment-heavy workflow changes out of the semantic-integrity release. The release fixes demonstrated safety, privacy, routing, and contract defects; this note preserves proposals that need product evidence and an explicit decision before runtime behavior changes.

## Decision boundary

None of the items below are accepted runtime changes. Each requires a focused product discussion, representative examples from consumer projects, and approval of the resulting behavior before implementation.

## Research evidence policy

### Question

Should Research replace the universal “three sources make a finding” rule with minimum evidence based on claim type?

### Candidate policy

| Claim | Candidate support |
|---|---|
| Organization-controlled fact | One current authoritative primary source; corroborate when disputed or consequential |
| Market pattern or causal claim | Two or three independent, methodologically credible sources |
| Customer problem | Multiple independent records with account or segment concentration shown |
| Absence finding | Search coverage, repositories or queries checked, and cutoff date |
| Inference | Supporting evidence, explicit hypothesis label, and uncertainty |
| Contradiction | Preserve evidence on both sides |

### Evidence needed

- Sample recent Research artifacts and classify their claims.
- Compare cost, clarity, and error rate under the current and candidate rules.
- Decide whether Landscape needs inline Evidence IDs or a companion claim map.

## Competitor coverage policy

### Question

Should competitor analysis require five files for every competitor, or require five facets with explicit `not-applicable` coverage?

### Candidate policy

Keep the analytical facets—profile, features, API, SEO, and sentiment—but permit a structured coverage record with status, reason, searches, and checked date when a facet is unavailable or irrelevant.

### Evidence needed

- Review competitors without a public API, meaningful SEO surface, or sentiment footprint.
- Measure how often mandatory files contain filler.
- Decide whether coverage records belong in frontmatter, a companion file, or the index.

## Strategy heuristics

### Questions

- Should 30 days trigger review instead of categorical staleness?
- Should Strategy require at least three non-goals, or surface a visible gap when the user confirms fewer?

### Evidence needed

- Compare strategy change frequency across active consumer projects.
- Review whether forced non-goals become invented or redundant.
- Define which material changes invalidate downstream strategy bindings.

## Feature inventory heuristics

### Questions

- Should the 8–20 feature and 3–6 area ranges remain guidance rather than target counts?
- When may Features and Ideate reuse a source-bound inventory instead of rescanning the repository?

### Candidate freshness rule

Reuse the inventory when its companion validates and either matches current HEAD or the intervening diff is small and cannot affect inventoried product surfaces. Rescan when missing, invalid, materially stale, or affected by the diff.

### Evidence needed

- Inventory repositories of different sizes and architectures.
- Define a deterministic affected-path test.
- Measure missed features and unnecessary scan cost.

## Ideate degraded mode

### Question

May Ideate publish evidence-ranked ideas when Strategy is absent?

### Candidate policy

Allow publication with `strategy_binding: null`, `strategic_fit: unverified`, and an evidence-only ranking. Do not claim strategy alignment or apply non-goal filtering until Strategy exists.

### Evidence needed

- Test early-stage projects without Strategy.
- Decide whether Groom may inherit the limitation or must resolve it before proposal drafting.

## Exit criteria

This batch is ready for implementation only when:

1. Representative artifacts or consumer-project evidence support each selected change.
2. The behavior, degraded modes, and migration impact are explicit.
3. The user approves each selected policy independently.
4. Runtime files, public documentation, validation, and regression fixtures have a scoped implementation plan.

## Next action

Run `pm:think` on one question at a time, starting with Research claim-type evidence because it has the clearest measurable tradeoff.
