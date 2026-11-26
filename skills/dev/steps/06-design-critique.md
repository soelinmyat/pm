---
name: Design Critique
order: 6
description: Review the changed UI with the Design Director, or capture and critique evidence, without loading later QA or code-review instructions
phase: design-critique
requires:
  - design-director.md
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

0. Choose the review path. Product UI is reviewed by the Design Director: read `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/design-director.md` and follow it in place of items 2 through 5 below. Items 1, 6 and 7 still apply, with the director's `report.json` as the `review` evidence. Use the capture path in items 2 through 5 only for a PM artifact or PDF, when the project's PM instructions say `Design review: capture`, when this session already recorded a capture report, or when the host cannot dispatch a separate reviewing agent.
1. Confirm the routed visual scope and current HEAD. This phase appears only when risk routing requires Design Critique; do not silently convert an unavailable environment into a pass or skip.
2. Invoke `pm:design-critique`. The skill invocation is the gate; an informal inline opinion does not satisfy it. Its route selects `product-ui` or `pm-artifact` independently from this embedded execution context.
3. Follow the declared capture guide and the skill's evidence contract. Produce commit-bound `route.json`, hash-bound `captures.json`, structured `report.json`, and accessible `report.html`; cover the required viewport/state or desktop/tablet/narrow/print matrix without private data.
4. Fix P0/P1 findings, preserve before captures, recapture affected states, and re-run deterministic plus visual review. Stop after two bounded rounds if blocking findings remain.
5. Run `scripts/design-critique-check.js` against current HEAD. Failed, blocked, and deferred outcomes stop this phase. Do not run QA, code review, verification, push, or PR work here.
6. Return a strict phase result with the current commit and passing `review` evidence pointing to the final retained round's absolute `report.json`; the human artifact remains `report.html`. Record it through `dev-session.js record`; never write prose fields into `session.json`.
7. The phase recorder reruns the full checker on the bound report, requires its explicit `passed` outcome, and writes the validated gate before advancing the session. Keep an attempt report on its original path. A failed checker or gate write leaves the session in Design Critique. An interrupted state write can replay the same phase result through the same checks. Use `dev-session.js gate --session <absolute session.json> --name design-critique` to repair a missing gate for a phase previously recorded by an older runtime, provided the retained evidence still passes current checks, and never hand-edit the gate manifest.

## Done-when

- The route and capture manifests cover the routed UI or PM artifact states and viewports with sanitized hash-bound evidence.
- No unresolved P0/P1 finding remains, or the phase is explicitly blocked for a product decision.
- On the director path: the Design Director approved at current HEAD and `scripts/design-director-check.js` passes, or the work is parked after its last round with the report retained.
- The Design Critique gate and phase evidence point to current HEAD and validate.

**Advance:** record the result and proceed to Step 07 (QA), as selected by the runner.
