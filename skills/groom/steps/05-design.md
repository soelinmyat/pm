---
name: Design
order: 5
description: Define user flows, states, interaction requirements, and optional prototype evidence
phase: design
applies_to: [standard, full, agent]
required_evidence: [design]
result_schema: groom-phase-result-v1
---

## Goal

Turn scope into implementation-neutral design requirements covering the primary flow, failure/empty/loading states, accessibility, responsiveness, and content behavior.

## How

Use existing product patterns and `references/prototype-format.md`. Produce structured design requirements whether or not a visual prototype is warranted. Create a prototype only when spatial or interaction decisions materially benefit from it, and bind its path/hash as evidence. Non-visual features still define API/CLI/operator experience and error states.

## Done-when

Every in-scope user interaction has observable behavior and important alternate states; any prototype is current, accessible, and source-bound.

**Advance:** proceed to Step 6 (Draft).
