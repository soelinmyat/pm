---
title: "PM workflow v2 follow-ups"
created: 2026-07-11
updated: 2026-07-11
status: backlog
---

# PM workflow v2 follow-ups

> Apply the `/pm:dev` harness lessons to adjacent skills only after dev v2 reaches behavioral parity.

## Shared extraction candidates

- Move canonical JSON state, atomic writes, phase-local loading, model profiles, capability probes, and structured results into shared runtime modules only after the dev-specific APIs stabilize.
- Keep skill-specific routing and evidence policies outside the shared layer. A generic workflow engine is still a non-goal.
- Reuse the same provider adapters for read-only reviewers, planners, and implementers with narrower authority profiles.

## `pm:rfc`

- Replace the “read all steps” contract with phase-local intake, generation, and review prompts.
- Move Markdown session state to the canonical JSON/session runner after legacy RFC resume fixtures exist.
- Remove provider CLI and fresh-agent mechanics from RFC prose. Use the shared runtime request and result contracts.
- Replace mandatory fixed reviewer counts with risk- and independence-based evaluator selection. Keep test-strategy review mandatory where the RFC contract requires it.
- Separate lifecycle state from artifact state. The current review step instructs the workflow to mark the RFC `approved` before the explicit human approval boundary; make `reviewed` and `approved` distinct states.
- Treat HTML as the human render and JSON as the machine contract. Generate both from one structured source to eliminate manual re-sync and hash-repair instructions.
- Make issue decomposition a structured planner result instead of parsing HTML anchors or asking the model to maintain twins.
- Preserve the compact Decision Brief and Execution Contract. Those are strong phase-local handoff boundaries.

## `pm:groom`

- Reuse phase-local prompts and model profiles for research, synthesis, and review.
- Route research fan-out by independent questions, not fixed agent counts.
- Store product decisions and evidence references structurally so RFC does not need to reconstruct them from prose.

## `pm:review`

- Emit the shared evidence envelope with commit binding, finding identity, confidence, disposition, and reviewer profile.
- Select lenses from risk dimensions while retaining a deterministic minimum review set.
- Reconcile duplicate findings programmatically before asking a model to synthesize them.

## `pm:ship`

- Keep push, PR, merge, and tracker mutations root-owned by default.
- Consume canonical gate evidence instead of rereading prose state.
- Represent authorization and completed external effects explicitly so resume cannot replay them.

## Promotion gate

Do not generalize the dev harness until:

- Dev v2 meets its prompt-reduction and behavioral parity targets on both workhorse profiles.
- Legacy resume and rollback paths are proven.
- The shared boundary can be stated without dev-specific stage names or Git assumptions.
