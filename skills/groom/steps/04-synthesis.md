---
name: Synthesis
order: 4
description: Derive structured product decisions from evidence and locked scope
phase: synthesis
applies_to: [standard, full, agent]
required_evidence: [synthesis]
result_schema: groom-phase-result-v1
---

## Goal

Derive the decision brief, audience/JTBD, alternatives, requirements, success logic, confidence, and open decisions without losing source lineage.

## How

Build independent synthesis questions for audience/JTBD, problem/evidence, alternatives, risks, and measurement. Answer inline or distribute by available capability; correctness depends on question coverage, not worker count. Merge only compatible answers, preserve disagreements, and cite the source or assumption behind each consequential decision.

Quick tier skips this phase and derives the minimum fields during Draft.

## Done-when

The structured synthesis is internally consistent, evidence-bound, explicit about confidence and alternatives, and contains no hidden product decision for engineering to infer.

**Advance:** proceed to Step 5 (Design).
