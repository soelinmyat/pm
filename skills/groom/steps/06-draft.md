---
name: Draft
order: 6
description: Assemble and validate the canonical structured proposal
phase: draft
applies_to: [quick, standard, full, agent]
required_evidence: [proposal, artifact]
result_schema: groom-phase-result-v1
---

## Goal

Write one canonical proposal JSON and deterministically generate its human and compatibility projections.

## How

Read `references/proposal-format.md`. Write `{pm_dir}/backlog/proposals/{slug}.json` atomically with lifecycle `draft`, revision 1 or the next valid revision. Persist one closed `design_context` whose requirement strings exactly mirror `design_requirements`, whose prototype is source-bound or explicit `null`, and whose critical states and visual invariants come from Step 5. Quick tier still supplies all integrity-critical fields, using explicit assumptions where depth is lower.

Run `proposal-render.js`, then `proposal-check.js` against JSON, HTML, and Markdown. Run `proposal-quality-check.js` separately: schema validity establishes eligibility; the quality score tests decision usefulness and must not be repaired by adding filler. If it fails, revise the weakest scored dimensions before continuing. Never patch generated projections or their hashes. Record exact paths, hashes, and the quality result in phase evidence.

## Done-when

Canonical JSON is schema-valid with durable design context, the committed quality threshold passes, and both projections are synchronized, accessible, offline, responsive, printable, and bound to the same proposal revision/hash.

**Advance:** proceed to Step 7 (Review).
