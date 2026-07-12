# Design Critique Quality Gate — Wave 3A

**Date:** 2026-07-12
**Baseline:** `origin/main` v1.13.13
**Status:** implementation

## Decision

Turn `pm:design-critique` into one evidence pipeline with two explicit subjects:

1. `product-ui` for implemented application interfaces.
2. `pm-artifact` for rendered PM documents such as proposal, RFC, and report HTML.

Execution context (`embedded` or `standalone`) remains separate from subject mode. The gate owns rendered quality, accessibility evidence, hierarchy, density, responsive behavior, and before/after visual proof. QA owns functional acceptance behavior. Review owns source correctness and maintainability.

## Bound artifact chain

The gate produces four durable files under `.pm/dev-sessions/{slug}/design-critique/`:

1. `route.json` freezes the source commit, base ref, diff hash, subject mode, surfaces, and applicable coverage inventory.
2. `captures.json` binds each required coverage item to a regular evidence file by SHA-256 and records accessibility, DOM, structural, render, and print evidence.
3. `report.json` binds the route and captures, records scored rubric dimensions, deterministic findings, resolution history, coverage accounting, rounds, and the final outcome.
4. `report.html` is the accessible, offline, printable human report. Its PM artifact metadata binds back to `report.json` and `captures.json`.

`scripts/design-critique-check.js` validates the chain against the current commit. A path, screenshot count, reviewer claim, or gate row alone cannot pass.

## Coverage policy

### Product UI

- Every changed surface declares primary, empty, error, boundary/long-content, and responsive applicability.
- Required states have exact capture entries; non-applicable states require a specific reason.
- Desktop is always covered. Tablet and narrow coverage are required for responsive surfaces.
- Each subject has accessibility evidence; web subjects also have a DOM/consistency audit.

### PM artifact

- The exact HTML bytes pass `artifact-check` and are bound by hash.
- Desktop, tablet, and narrow full-document renders are present.
- A non-empty print PDF and render manifest are present.
- Navigation, hierarchy, density, accessibility, responsive, and print dimensions are scored.

## Finding policy

- Finding IDs are derived from stable subject, region, rule, and evidence identity.
- Every finding cites capture/evidence IDs rather than prose-only observations.
- Resolved P0/P1 findings require distinct before and after capture hashes.
- Open or deferred P0/P1 findings prevent `passed`.
- P2 may be deferred with owner and reason. P3 is advisory.
- The fix/re-capture/re-review loop is capped at two rounds.
- Product authority may choose a direction, but cannot relabel unresolved blocking evidence as a passing gate.

## Outcome semantics

| Report outcome | Meaning | Dev gate mapping |
|---|---|---|
| `passed` | Full applicable coverage; no unresolved P0/P1 | `passed` |
| `failed` | Review completed and blocking findings remain | `failed` |
| `blocked` | Required rendering, data, auth, or evidence unavailable | `blocked` |
| `deferred` | A human postponed a blocking design decision | `blocked`, with the decision recorded |

`skipped` remains a Dev routing outcome for a proven no-visual-impact diff; it is not a critique result.

## Verification

- Unit tests for stale commit, changed bytes, path escape, missing coverage, invalid mode evidence, score coverage, finding identity, before/after proof, round bounds, and outcome mapping.
- Skill regression tests for both modes, ownership boundaries, authoring contract, gate preservation, and exact checker invocation.
- Existing Dev, artifact, behavioral-eval, and quality-eval suites remain green.

## Release gate

- Reference product-UI and PM-artifact fixture chains pass the checker.
- Mutating any source, route, capture, report, or HTML byte fails closed.
- `pm:dev` consumes the new evidence contract without changing QA or Review ownership.
- Full suite, plugin validation, six-lens review, cache smoke test, and CI pass.
