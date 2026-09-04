---
name: Handoff
order: 10
description: Verify the approved execution contract and perform authorized integrations
phase: handoff
applies_to: [quick, standard, full, agent]
required_evidence: [handoff]
result_schema: groom-phase-result-v1
---

## Goal

Deliver an approved, machine-consumable product contract to RFC/Dev and perform only explicitly authorized tracker effects.

## How

Run `proposal-check.js` in approved mode and verify RFC/Dev can read scope, non-goals, acceptance criteria, design requirements, edge cases, evidence, and open decisions directly from JSON. For UI work, make the design handoff durable: preserve the approved design requirements; the prototype path plus its SHA-256 identity (or an explicit `null` when no prototype was approved); every critical state; and the visual invariants that implementation must not trade away. The generated backlog Markdown remains a compatibility projection.

Before completing handoff, commit the approved canonical proposal, approval audit, and
current projection together on the session's helper-owned Groom artifact branch. Leave
the branch without an upstream and do not publish it here. The RFC isolation helper uses
that clean local commit as its base so an immediate `pm:rfc {slug}` handoff preserves the
exact approved bytes without touching the shared checkout.

When intake recorded a Think or Ideate decision companion, read `references/product-reasoning.md` and run its atomic `promote` transition only now, after the approved canonical proposal, sibling approval audit, and final generated backlog projection exist. The proposal renderer detects a canonical Ideate companion in proposal lineage and preserves `reasoning_version: 2` plus `decision_brief` in that final projection; do not strip or hand-edit those generated markers. Pass the Groom session's exact approval decision ID/hash, bind the companion to both final artifacts, verify its target is the canonical proposal JSON, then run normal PM validation. If an origin Markdown status or projection must change, change it before this one final promotion call. This is origin lineage, not product approval; a legacy source without a companion needs no synthetic backfill.

For Linear or another tracker, require explicit `tracker_updates` authority and use an idempotent effect receipt bound to the exact target before create/update. Resume by verifying ambiguous outcomes before replay. Never create RFC child work or approve technical design here.

## Done-when

The approved execution contract, including any UI design requirements, source-bound prototype identity, critical states, and visual invariants, is independently readable and committed on the clean
helper-owned Groom branch, projection status is current, and every external effect is
either verified by receipt or explicitly skipped.

**Advance:** proceed to Step 11 (Retro).
