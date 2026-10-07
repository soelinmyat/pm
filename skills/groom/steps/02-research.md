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
- Trace the customer-to-commercial value chain: who benefits, the observable outcome, and who buys or authorizes it when known. Keep the commercial mechanism as a hypothesis unless direct evidence establishes it; user friction alone does not prove purchasing, adoption, or retention value. An unknown buyer or unavailable commercial evidence is an explicit limit, not a reason to fabricate a claim.
- Retain counterevidence (or the checked search basis and its limits when none was found), the consequential uncertainty, and the smallest observation that could change a build/test-first/defer recommendation. Keep source citations and assumption identities available for Scope to bind into `decision_brief.value_decision`; record this material in the evidence packet, not new session keys.

Record the evidence packet and strict phase result through the runner.

## Done-when

Every material downstream claim has a traceable evidence source or an explicit assumption, freshness/contradiction risks are visible, and the value chain's known and unknown parts can support a calibrated Scope recommendation.

**Advance:** proceed to Step 3 (Scope).
