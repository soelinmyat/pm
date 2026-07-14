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

Run `proposal-check.js` in approved mode and verify RFC/Dev can read scope, non-goals, acceptance criteria, design requirements, edge cases, evidence, and open decisions directly from JSON. The generated backlog Markdown remains a compatibility projection.

When intake recorded a Think or Ideate decision companion, read `references/product-reasoning.md` and run its atomic `promote` transition only now, after the approved canonical proposal, sibling approval audit, and final generated backlog projection exist. The proposal renderer detects a canonical Ideate companion in proposal lineage and preserves `reasoning_version: 2` plus `decision_brief` in that final projection; do not strip or hand-edit those generated markers. Pass the Groom session's exact approval decision ID/hash, bind the companion to both final artifacts, verify its target is the canonical proposal JSON, then run normal PM validation. If an origin Markdown status or projection must change, change it before this one final promotion call. This is origin lineage, not product approval; a legacy source without a companion needs no synthetic backfill.

For Linear or another tracker, require explicit `tracker_updates` authority and use an idempotent effect receipt bound to the exact target before create/update. Resume by verifying ambiguous outcomes before replay. Never create RFC child work or approve technical design here.

## Done-when

The approved execution contract is independently readable, projection status is current, and every external effect is either verified by receipt or explicitly skipped.

**Advance:** proceed to Step 11 (Retro).
