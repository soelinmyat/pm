---
name: Design Critique
order: 6
description: Capture and critique current UI evidence without loading later QA or code-review instructions
phase: design-critique
requires:
  - design-critique.md
  - design-critique-capture-guide.md
gates:
  - design-critique
required_evidence:
  - review
requires_commit: true
allowed_modes:
  - inline
  - delegated
result_schema: phase-result-v1
---

## Goal

Produce current, sanitized visual evidence for the changed UI, resolve blocking design findings, and record only the Design Critique gate for the current commit.

## How

1. Confirm the routed UI scope and current HEAD. This phase appears only when risk routing requires Design Critique; do not silently convert an unavailable environment into a pass or skip.
2. Read the declared capture and critique references. Create sanitized seed states covering the primary flow, empty state, realistic edge state, and relevant error state.
3. Capture the required viewport set plus accessibility and consistency evidence. Store a manifest that identifies route/state, viewport, artifact path, and current commit. Never capture private customer data.
4. Invoke `pm:design-critique`. The skill invocation is the gate; an informal inline opinion does not satisfy it. Fix P0/P1 findings, recapture affected states, and re-run the critique. Stop after two bounded rounds if blocking findings remain.
5. Write the critique report as the evidence artifact and update the gate manifest with `design-critique: passed` for current HEAD. Do not run QA, code review, verification, push, or PR work in this phase.
6. Return a strict phase result with the current commit and passing `review` evidence pointing to the critique report. Record it through `dev-session record`; never write prose fields into `session.json`.

## Done-when

- The capture manifest covers the routed UI states and viewports with sanitized evidence.
- No unresolved P0/P1 finding remains, or the phase is explicitly blocked for a product decision.
- The Design Critique gate and phase evidence point to current HEAD and validate.

**Advance:** record the result and proceed to Step 07 (QA), as selected by the runner.
