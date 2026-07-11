---
name: Capture
order: 2
description: Capture every required route item and bind enriched evidence by hash
---

## Goal

Create `captures.json` with complete, sanitized, byte-bound rendered and enriched evidence for the frozen route.

## How

Read and follow `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/design-critique-capture-guide.md` and `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/design-critique-seed-conventions.md`, then apply the mode-specific rules in `evidence-contract.md`.

1. Use the project’s documented server, seed, authentication, browser, simulator, and capture commands. Real application state is required for product UI; do not substitute Storybook or request mocks.
2. Capture every `required: true` coverage row exactly once in the current round. Copy durable evidence under `.pm/dev-sessions/{slug}/design-critique/round-{N}/`; passing evidence cannot live only in `/tmp`.
3. For product UI, capture the exact routed states/viewports, an accessibility tree for every subject, and a DOM/visual-consistency audit for each web subject.
4. For PM artifacts, run `artifact-check.js` and `artifact-render-check.js` against the exact HTML; retain their manifests, desktop/tablet/narrow full-document images, accessibility evidence, and non-empty print PDF.
5. Record paths, byte hashes, dimensions, coverage IDs, capture time, subject IDs, and evidence kinds in `captures.json`. Never record private customer data; use sanitized seeds.
6. Self-check for obvious clipping, missing content, wrong auth state, stale data, capture chrome, and route mismatch. Correct and recapture before review.
7. If a required app, auth flow, seed, browser, simulator, artifact, or privacy-safe state is unavailable, record a concrete blocked outcome. Do not downgrade an environment failure to skipped or passed.

## Done-when

- Every required route row has exactly one current capture and no non-applicable row has a capture.
- Every subject has the mode-required enriched evidence.
- All files are durable, sanitized, regular files under the project root and their SHA-256 values match `captures.json`.

**Advance:** if blocked, record the recovery and return; otherwise proceed to Step 3 (Evaluate).
