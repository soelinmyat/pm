---
name: Design
order: 5
description: Define user flows, states, interaction requirements, and optional prototype evidence
phase: design
applies_to: [quick, standard, full, agent]
required_evidence: [design]
result_schema: groom-phase-result-v1
---

## Goal

Turn scope into implementation-neutral design requirements covering the primary flow, failure/empty/loading states, accessibility, responsiveness, and content behavior.

## How

Use existing product patterns and `references/prototype-format.md`. Classify `ui_impact` explicitly before authoring the contract. Produce structured design requirements whether or not a visual prototype is warranted. Nonvisual features define honest API/CLI/operator experience and error states in `experience_invariants`, keep `visual_invariants` empty, and use `prototype: null`; they do not invent layout language to satisfy a schema.

For `quick`, keep this pass bounded to the primary experience and consequential alternate states. Knowledge-base depth never removes experience risk: state unsupported choices as assumptions and make the riskiest one visible to Review.

For a user-facing visual surface, run this concise craft loop:

1. Inspect the existing product, design tokens, shared components, and project principles. Name the visual language to preserve and any deliberate departure.
2. State the design intent and scan hierarchy before drawing: user job, focal point, primary action, and order of secondary information.
3. When no established design-system pattern already decides the layout and the spatial choice matters, compare two materially different compositions. Choose one against the user job, content shape, and responsive constraints; do not manufacture alternatives when the established pattern is the answer.
4. Define real content and labels, primary and secondary actions, information density, typography hierarchy, responsive behavior, and applicable interaction states. Include default, hover/focus/active, disabled, loading, empty, error, success, keyboard, and modal behavior only where each applies.
5. Create a prototype when spatial or interaction decisions materially benefit from it and bind its complete identity as evidence. Use `scripts/prototype-identity.js`: single-file prototypes bind that file, while multi-file prototypes bind a sorted, bounded tree manifest covering `index.html`, `meta.json`, `base.css`, every screen, and any supporting asset. Render it at desktop and narrow widths, inspect the rendered result visually and against its DOM/accessibility structure, then refine it once before review.
6. Separate objective defects—such as overflow, inaccessible controls, missing states, or broken hierarchy—from subjective craft choices such as stylistic taste. Resolve objective defects; record consequential judgment calls and their rationale without presenting preference as correctness.

## Done-when

Every in-scope user interaction has observable behavior and important alternate states; visual work completed the craft loop; any prototype is current, accessible, responsive, refined, and source-bound.

**Advance:** proceed to Step 6 (Draft).
