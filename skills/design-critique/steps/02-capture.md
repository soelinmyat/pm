---
name: Capture
order: 2
description: Capture every required route item and bind enriched evidence by hash
---

## Goal

Create `captures.json` with complete, sanitized, byte-bound rendered and enriched evidence for the frozen route.

## How

Read and follow `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/design-critique-capture-guide.md` and `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/design-critique-seed-conventions.md`, then apply the mode-specific rules in `evidence-contract.md`.

1. Use the project’s documented server, seed, authentication, browser, simulator, and capture commands. Real application state is required for product UI; do not substitute Storybook or request mocks. Web capture needs a privacy-safe seeded route that works in the helper's clean browser profile without embedding credentials in the URL. The manifest retains only redacted URL components plus a full-URL hash.
2. Capture every `required: true` coverage row exactly once in the current round. Copy durable evidence under `.pm/dev-sessions/{slug}/design-critique/round-{N}/`; passing evidence cannot live only in `/tmp`.
3. For each schema-v2 web product-UI row, use a supported safe route surface and write a closed schema-v2 state assertion whose subject, coverage, state, and visible `data-pm-state` marker exactly match that row. Then run `scripts/design-critique-capture.js`. The helper captures one screenshot plus raw accessibility and DOM observations from one CDP page/session, verifies native visibility/hit-testing and a closed network window, and publishes their hash-bound workflow attestation atomically. Do not combine a manual screenshot with separately collected probes. Normalize the helper's two raw audit files with `design-critique-audit-normalize.js`; never author their checks or findings. Each normalized audit cites exactly the helper capture ID and binds the raw file named in its capture manifest. For route schema v2, every web subject needs separate `primary` desktop and `primary` narrow screenshots; a different narrow state does not substitute for the primary narrow view.
4. For PM artifacts, run `artifact-check.js` and `artifact-render-check.js` against the exact HTML; retain their manifests, desktop/tablet/narrow full-document images, a raw accessibility probe plus its generated normalized audit, and a non-empty print PDF.
5. Record paths, byte hashes, canonical decoded-pixel hashes, dimensions, coverage IDs, capture time, subject IDs, evidence kinds, and the capture-manifest `observation` binding in `captures.json`. For schema-v2 web routes, assign desktop, tablet, and narrow labels from the decoded PNG dimensions—not the intended browser setting—and stay within the bands in `evidence-contract.md`. The helper rejects near-blank images and non-material state or P0/P1 before/after changes. Never record private customer data; use sanitized seeds.
6. Self-check for obvious clipping, missing content, wrong auth state, stale data, capture chrome, and route mismatch. Correct and recapture before review.
7. If a required app, auth flow, seed, browser, simulator, artifact, or privacy-safe state is unavailable, record a concrete blocked outcome. Do not downgrade an environment failure to skipped or passed.

## Done-when

- Every required route row has exactly one current capture and no non-applicable row has a capture.
- Every subject has the mode-required enriched evidence, and every active product-UI capture has exactly one required audit of each applicable kind at its measured viewport.
- Every schema-v2 accessibility/DOM audit binds retained raw probe bytes and exactly matches deterministic normalization.
- Every schema-v2 web product-UI capture binds a passing trusted capture manifest whose route surface, exact state assertion, native visibility/hit test, viewport, redacted URL identity, source, current browser identity, closed network ledger, screenshot bytes, decoded pixels/visual metrics, and raw observations agree.
- All files are durable, sanitized, regular files under the project root and their SHA-256 values match `captures.json`.

**Advance:** if blocked, record the recovery and return; otherwise proceed to Step 3 (Evaluate).
