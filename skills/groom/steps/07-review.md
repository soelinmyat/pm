---
name: Review
order: 7
description: Answer independent product-quality questions against frozen proposal evidence
phase: review
applies_to: [standard, full, agent]
required_evidence: [review]
result_schema: groom-phase-result-v1
---

## Goal

Establish whether the exact draft is decision-ready and implementation-useful through complete, evidence-bound question coverage.

## How

Read `references/review-questions.md`. Freeze proposal identity, select tier-required questions, and answer them independently inline or through available workers. Each answer carries verdict, evidence, confidence, and actionable finding. Synthesize disagreements explicitly.

Blocking revisions increment the proposal revision, invalidate prior review/approval, regenerate projections, rerun `proposal-quality-check.js`, and rerun every affected question. A run lineage has at most three remediation rounds. Advisory debt remains visible without inventing another round.

## Done-when

Every required question has a current answer, no blocking finding or unresolved dispute remains, and review evidence binds the exact current proposal hash/revision.

**Advance:** if tier is `full` or `agent`, proceed to Step 8 (Presentation); otherwise proceed to Step 9 (Approval).
