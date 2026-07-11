---
name: Resolve
order: 4
description: Fix blocking findings and prove changes with bounded before-and-after evidence
---

## Goal

Resolve P0/P1 design findings through a bounded fix, recapture, and re-review loop while preserving authority and history.

## How

1. P0 means unusable, inaccessible, unsafe, or severely broken presentation. P1 means likely user confusion, broken responsive/print behavior, or a major hierarchy/consistency failure. Neither may remain open or deferred in a passing report.
2. In embedded Dev execution, return findings to the implementing agent for fixes. In standalone execution, implement only fixes the user’s request authorizes. Product-direction choices require explicit user authority.
3. After each fix, run relevant deterministic/project tests, capture a new evidence file, retain the before file, and update the finding with distinct `before_capture_id` and `after_capture_id` hashes.
4. Re-run deterministic checks and both review perspectives on affected coverage. Fresh Eyes still receives no previous findings.
5. Stop after two total review rounds. If blocking findings remain, use `failed`; if required evidence is unavailable, use `blocked`; if a human postpones a blocking choice, use `deferred` with approver and decision. None maps to a passing gate.
6. P2 may be deferred with a concrete reason and owner. P3 is advisory. Dismissal requires evidence showing the finding is invalid or outside this gate’s ownership.

## Done-when

- Every P0/P1 is resolved with distinct before/after evidence, or the report has an honest non-passing outcome.
- No more than two rounds ran and previous evidence remains available.
- Deferred/dismissed findings carry the required reason, owner, and authority trail.

**Advance:** proceed to Step 5 (Publish).
