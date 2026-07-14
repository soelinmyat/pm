---
name: Research
order: 2
description: Bind current evidence and strategy to the product decision
phase: research
applies_to: [quick, standard, full, agent]
required_evidence: [research]
result_schema: groom-phase-result-v1
---

## Goal

Produce a current, traceable evidence packet that states what is known, assumed, stale, contradictory, and missing.

## How

- `quick`: perform a bounded inline assessment of supplied evidence, codebase facts, and relevant KB entries; "no evidence found" is a recorded finding.
- `standard`/`full`: consume or run `pm:research` as needed, then bind exact evidence paths, identities, freshness, and strategy constraints.
- `agent`: require fresh strategy, at least three active insights, and two competitor profiles; record actual gaps rather than provider-specific refusal.
- Separate observations from assumptions. Preserve contradictory evidence and its effect on confidence. Do not invent citations.

Record the evidence packet and strict phase result through the runner.

## Done-when

Every material downstream claim has a traceable evidence source or an explicit assumption, and freshness/contradiction risks are visible.

**Advance:** proceed to Step 3 (Scope).
