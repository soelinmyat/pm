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
5. For consequential app navigation, interaction, composition or content-growth decisions, follow the runnable in-app mode in `references/prototype-format.md`: use an isolated consumer worktree, real incumbent components/navigation and separate realistic synthetic fixtures. Use `scripts/app-preview.js prepare`, exercise the declared journeys and states, retain fresh observation bytes, then `complete` the exact `design_context.app_preview` identity with `prototype: null`. Preserve the accepted source delta as reviewed starting code for RFC/Dev; mock fixtures remain separate from production integration. If a bounded established pattern or document/information layout is adequately decided without an app journey, state that reason and use the inert mode when a visual prototype is warranted. `scripts/prototype-identity.js` still binds single-file HTML or the complete inert tree; it never permits active app scripts. Render applicable desktop/narrow and content-growth states, inspect pixels and DOM/accessibility, then refine before review. Keep unavailable source/runtime/pixels as an explicit unresolved limitation, not a high-confidence experience claim.
6. Separate objective defects—such as overflow, inaccessible controls, missing states, or broken hierarchy—from subjective craft choices such as stylistic taste. Resolve objective defects; record consequential judgment calls and their rationale without presenting preference as correctness.

## Done-when

Every in-scope user interaction has observable behavior and important alternate states; visual work completed the craft loop; consequential app journeys have an exact current runnable preview handoff or an explicit unresolved limitation. Any inert prototype remains accessible, responsive and source-bound. Accepted preview UI source is adoptable independently of mock fixtures; mocked observation never claims backend certification.

**Advance:** proceed to Step 6 (Draft).
