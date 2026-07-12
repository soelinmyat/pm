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

1. Confirm the routed visual scope and current HEAD. This phase appears only when risk routing requires Design Critique; do not silently convert an unavailable environment into a pass or skip.
2. Invoke `pm:design-critique`. The skill invocation is the gate; an informal inline opinion does not satisfy it. Its route selects `product-ui` or `pm-artifact` independently from this embedded execution context.
3. Follow the declared capture guide and the skill's evidence contract. Produce commit-bound `route.json`, hash-bound `captures.json`, structured `report.json`, and accessible `report.html`; cover the required viewport/state or desktop/tablet/narrow/print matrix without private data.
4. Fix P0/P1 findings, preserve before captures, recapture affected states, and re-run deterministic plus visual review. Stop after two bounded rounds if blocking findings remain.
5. Run `scripts/design-critique-check.js` against current HEAD. Only a checked `passed` report may create `design-critique: passed` in the gate manifest. Failed, blocked, and deferred outcomes stop this phase. Do not run QA, code review, verification, push, or PR work here.
6. Return a strict phase result with the current commit and passing `review` evidence pointing to `report.html`. Record it through `dev-session record`; never write prose fields into `session.json`.

## Done-when

- The route and capture manifests cover the routed UI or PM artifact states and viewports with sanitized hash-bound evidence.
- No unresolved P0/P1 finding remains, or the phase is explicitly blocked for a product decision.
- The Design Critique gate and phase evidence point to current HEAD and validate.

**Advance:** record the result and proceed to Step 07 (QA), as selected by the runner.
