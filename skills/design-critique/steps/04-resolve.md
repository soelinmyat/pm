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
3. After each fix, run relevant deterministic/project tests, capture a new evidence file, retain the before file, and update the finding with distinct `before_capture_id` and `after_capture_id` hashes. Both round numbers and `captured_at` timestamps must order before strictly before after.
4. Re-run deterministic checks and create a new Primary/Fresh Eyes pair. Both perspectives receive the complete current active capture set so regressions outside the fixed region remain visible. For every later round, create its new captures and manifest only after both preceding-round receipts are recorded; include at least one new capture and do not start either review before that manifest exists. Primary receives prior finding references plus the hash-bound `prior_findings_source` that exactly materializes those earlier findings; Fresh Eyes still receives no previous findings, audits, acceptance context, implementation rationale, or review history. Use new context and invocation identities for both results.
5. After two unresolved rounds, retain a finalized `failed` report and diagnose its observed failure, grounded in predecessor finding, capture or review IDs. Embed a concrete changed approach, next check, classification and scope assessment in the next round's `recovery`, plus its immutable `previous_report` binding. Continue within approved behavior without routine human reapproval; a genuine product/commercial/security/privacy/operational change or unavailable dependency remains `blocked`. A postponed blocking choice remains `deferred` with real approver and decision. Every non-passing outcome withholds the gate; do not repeat an unchanged remedy or reset counts/run IDs.
6. P2 may be deferred with a concrete reason and owner. P3 is advisory. Dismissal requires evidence showing the finding is invalid or outside this gate’s ownership. Never lower source severity. A higher final severity requires a concrete rationale and at least one decision-evidence item with new bound bytes or decoded pixels, not a copied source artifact under another ID. Any Design-owned source that remains or becomes P0/P1 stays Design-owned through resolution.

## Done-when

- Every P0/P1 is resolved with distinct before/after evidence, or the report has an honest non-passing outcome.
- Consecutive rounds retain their complete failure history; beyond round two, grounded diagnosis and a changed scoped approach are present. Resource limits remain explicit.
- Every round retains its independently bound reviewer pair and reconciliation trail.
- Deferred/dismissed findings carry the required reason, owner, and authority trail.

**Advance:** proceed to Step 5 (Publish).
