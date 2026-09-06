---
name: Review
order: 7
description: Answer independent product-quality questions against frozen proposal evidence
phase: review
applies_to: [quick, standard, full, agent]
required_evidence: [review]
result_schema: groom-phase-result-v1
---

## Goal

Establish whether the exact draft is decision-ready and implementation-useful through complete, evidence-bound question coverage.

## How

Read `references/review-questions.md`. Freeze proposal identity, select tier-required questions, and answer them independently inline or through available workers. Each answer carries a separate conclusion and rationale, verdict, precise evidence locator with answer-specific relevance, confidence, and actionable finding. Reject copied prompts, repeated rationales, and one generic evidence explanation reused across the question set. Synthesize disagreements explicitly.

For `quick`, run the two routed questions (`assumption-risk` and `experience`) as a bounded adversarial pass. Sparse knowledge increases scrutiny of assumptions; it does not justify skipping design or independent review. Standard/full/agent keep their broader question sets.

If the frozen proposal has prototype evidence, also read the `@designer` — Visual Quality brief in `references/team-reviewers.md` and execute that prototype designer review against the bound prototype bytes. Run it as an independent worker when available or as an isolated second pass inline. Fold its spec, flow, state, accessibility, existing-pattern, and label-consistency findings into the Experience completeness question without replacing the other routed questions. Treat evidence-backed missing/broken states and unusable or inaccessible behavior as blocking; keep unsupported aesthetic preference advisory. If no prototype exists, do not invent a visual review.

Blocking revisions increment the proposal revision, invalidate prior review/approval, regenerate projections, rerun `proposal-quality-check.js`, and rerun every affected question. A run lineage has at most three remediation rounds. Advisory debt remains visible without inventing another round.

When all routed questions pass, persist exactly one answer per `review_contract.required_question_ids` entry in `question_reviews`, with the same `question_id` and `id: review:{question_id}`. Copy the exact normalized answer into the Review phase result; the runtime rejects any divergence between canonical and session rows. Do not accept one representative answer as coverage. Set `review.status: passed` with the current revision, semantic content hash, and completion time, and transition the canonical lifecycle from `draft` to `reviewed`. If writing review answers changes canonical semantic content after Draft was recorded, advance the proposal revision before recording Review. Regenerate both projections and run `proposal-check.js --projections` before recording the Review phase result. The session proposal identity recorded by that result must point to these reviewed canonical bytes.

## Done-when

Every required question has a current answer, any bound prototype has a current designer review, no blocking finding or unresolved dispute remains, and both canonical proposal review metadata and session review evidence bind the exact current proposal hash/revision.

**Advance:** if tier is `full` or `agent`, proceed to Step 8 (Presentation); otherwise proceed to Step 9 (Approval).
