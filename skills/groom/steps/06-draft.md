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

Read `references/proposal-format.md`. Write `{pm_dir}/backlog/proposals/{slug}.json` atomically with lifecycle `draft`, revision 1 or the next valid revision. Copy the trusted session identity, selected tier, and ordered `routing.review_questions` IDs into `review_contract`; never infer or shorten that list in proposal prose. Copy the scoped `value_decision` into `decision_brief.value_decision`; keep cited evidence/assumption IDs, unknown buyer, uncertainty, recommendation and its discriminating test. New CLI sessions mark `context.product_contract_version: 1` and enforce this contract; old sessions remain readable. Persist one closed `design_context` whose requirement strings exactly mirror `design_requirements`, whose UI impact is explicit, whose prototype is fully source-bound or explicit `null`, and whose critical states plus experience/visual invariants come from Step 5. A consequential app journey carries the complete prepared/observed `app_preview` identity with `prototype: null` and explicit `context.preview_source_root`; preserve the exact reviewed source until adoption. Multi-file prototype identity includes its complete manifest, not only `index.html`. Quick tier still supplies all integrity-critical fields, using explicit assumptions where depth is lower.

Run `proposal-render.js`, then `proposal-check.js` against JSON, HTML, and Markdown. Run `proposal-quality-check.js` separately: schema validity establishes eligibility; the score tests structural readiness, not decision usefulness or semantic quality. It detects missing, vague, or malformed material; it cannot establish that evidence supports the proposal or that the experience works. If it fails, inspect the flagged dimensions and repair the real omission rather than adding filler. Independently judge the problem, scope, evidence, weakest user outcome, and material uncertainty even when the structural threshold passes. Never patch generated projections or their hashes. Record exact paths, hashes, and the quality result in phase evidence.

## Done-when

Canonical JSON is schema-valid with a session-bound tier review contract and durable design context, the committed quality threshold passes, and both projections are synchronized, accessible, offline, responsive, printable, and bound to the same proposal revision/hash.

**Advance:** proceed to Step 7 (Review).
