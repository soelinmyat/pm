---
name: Scope and route
order: 1
description: Freeze subject mode, source identity, ownership, surfaces, and coverage decisions
---

## Goal

Create `route.json`, a complete and reviewable coverage contract bound to the current source commit and diff.

## How

1. Resolve the default branch and compute current HEAD plus the SHA-256 of `git diff --binary {base}...HEAD`. Do not reuse a route created for another commit or diff.
2. Select exactly one subject mode from the evidence, never from execution context:
   - `product-ui` for a running web/mobile interface;
   - `pm-artifact` for rendered proposal, RFC, report, or other PM HTML.
3. Keep ownership explicit: Design Critique owns rendered hierarchy, density, consistency, accessibility evidence, state presentation, responsive behavior, and print/navigation craft. QA owns functional behavior. Review owns source correctness and maintainability.
4. List each changed route, screen, component, or document as a stable subject. For product UI, decide applicability for primary, empty, error, and boundary/long-content states; require desktop for web and responsive viewport rows where the surface can reflow. For PM artifacts, require desktop, tablet, narrow, and print rows.
5. For every non-applicable row, record a specific product reason. “Not needed” is not a reason.
6. Save the route under `.pm/dev-sessions/{slug}/design-critique/route.json` using `evidence-contract.md`. Do not delete an earlier valid run; namespace a new run when HEAD changes.
7. If the diff has proven no visual impact, do not fabricate a critique route. Record `design-critique: skipped` in the Dev sidecar with the exact current commit and specific no-visual-impact reason, preserving all other rows.

## Done-when

- Subject mode, source commit/base/diff identity, ownership, subjects, and every applicable/non-applicable coverage row are explicit.
- A reviewer can identify every required state and viewport without reading the source diff again.
- A routed skip, if applicable, is current and passes the Dev gate checker.

**Advance:** if skipped, return the routed skip outcome; otherwise proceed to Step 2 (Capture).
