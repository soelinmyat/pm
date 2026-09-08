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

Run `proposal-check.js --approved --projections` with the session decision ID/hash and verify RFC/Dev can read scope, non-goals, acceptance criteria, design requirements, edge cases, evidence, and open decisions directly from JSON. The `--approved` mode is mandatory for handoff; ordinary proposal inspection is intentionally compatibility-readable and is not approval certification. Verify `design_context` contains the approved design requirements, explicit UI-impact classification, every critical state, and the applicable experience/visual invariants. Its prototype is `null` for nonvisual work, a recomputed single-file binding, or a recomputed multi-file tree manifest; an `index.html`-only legacy binding cannot enter a current handoff. This canonical field—not a hand-authored RFC sidecar—is the design handoff. The generated backlog Markdown remains a compatibility projection.

Before completing handoff, commit the approved canonical proposal, approval audit, and
current projection together on the session's helper-owned Groom artifact branch. Leave
the branch without an upstream and do not publish it here. The RFC isolation helper uses
that clean local commit as its base so an immediate `pm:rfc {slug}` handoff preserves the
exact approved bytes without touching the shared checkout.

When intake recorded a Think or Ideate decision companion, read `references/product-reasoning.md` and run its atomic `promote` transition only now, after the approved canonical proposal, sibling approval audit, and final generated backlog projection exist. The proposal renderer detects a canonical Ideate companion in proposal lineage and preserves `reasoning_version: 2` plus `decision_brief` in that final projection; do not strip or hand-edit those generated markers. Pass the Groom session's exact approval decision ID/hash, bind the companion to both final artifacts, verify its target is the canonical proposal JSON, then run normal PM validation. A Think origin can have a different slug from the retained Groom session; set its reader `promoted_to` to the approved target slug without renaming or rehashing the approved proposal. Ideate origins keep matching slugs because their backlog reader is the generated projection. If an origin Markdown status or projection must change, change it before this one final promotion call. This is origin lineage, not product approval; a legacy source without a companion needs no synthetic backfill.

For Linear or another tracker, require explicit `tracker_updates` authority and use an idempotent effect receipt bound to the exact target before create/update. Resume by verifying ambiguous outcomes before replay. Never create RFC child work or approve technical design here.

## Done-when

The approved execution contract, including UI-impact classification, experience requirements, complete source-bound prototype identity, critical states, and applicable invariants, is independently readable and committed on the clean
helper-owned Groom branch, projection status is current, and every external effect is
either verified by receipt or explicitly skipped.

**Advance:** proceed to Step 11 (Retro).
