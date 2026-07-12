# Review Quality Gate — Wave 3B

**Date:** 2026-07-12  
**Baseline:** `origin/main` v1.13.14  
**Workhorse profiles:** GPT-5.6 Sol High and Claude Opus 4.8 xHigh

## Problem

`pm:review` has strong lens briefs but its authoritative contract is still a 500-line prompt. Findings, target identity, deduplication, reviewer allocation, fix rounds, disagreements, and the final pass are prose conventions. A capable model can execute them, but downstream gates cannot distinguish a current complete review from a plausible summary.

The quality problem is also broader than schema. Six generic prompts create duplicated findings, spend reviewers uniformly on every diff, blur source-design review with rendered Design Critique, and encourage auto-fixing based on confidence alone.

## Outcome

Turn Review into an evidence-bound source-quality gate:

1. Freeze the exact commit, authoritative remote base commit, binary diff hash, changed-file inventory, risk route, acceptance criteria, and upstream gate identities in `target.json`.
2. Plan every required logical lens exactly once while adapting physical reviewer count to available capacity and model profile.
3. Require each reviewer to emit hash-bound JSON with structured evidence and deterministic finding identities.
4. Merge exact duplicates by finding ID while retaining independent reviewer signals.
5. Detect conflicting severity, ownership, remediation, and disposition as explicit disagreements; never hide them through deduplication.
6. Permit automatic fixes only for review-owned, high-confidence, non-disputed findings with a concrete verification command and no product/design decision.
7. Bind every fix round to a new target and a complete new logical-lens wave. Old results become stale by construction.
8. Publish a canonical `report.json` and readable `report.html`; the Dev review gate points to the checked report, not a Markdown claim.

## Ownership

| Gate | Owns | Does not own |
|---|---|---|
| Review | Source correctness, contracts, tests, reuse, maintainability, efficiency, source-level design-system violations | Rendered hierarchy/craft, live flow correctness, product scope decisions |
| Design Critique | Rendered visual hierarchy, density, responsive/print craft, evidence-backed accessibility presentation | Source architecture or functional flow correctness |
| QA | Live behavior, navigation, state transitions, integrations, runtime recovery | Static maintainability or visual taste |

Review findings may route to `design-critique` or `qa`, but those handoffs cannot block or pass Review. A Review pass means no unresolved Review-owned blocker; it does not impersonate the other gates.

## Durable chain

Store under `.pm/dev-sessions/{slug}/review/`:

- `target.json` — immutable current-round review target and allocation plan.
- `results/{worker-id}.json` — one result per planned physical reviewer.
- `decisions.json` — explicit human decisions for disputed or decision-required findings; optional when empty.
- `report.json` — canonical merged outcome and bindings.
- `report.html` — readable projection with verdict, coverage, blockers, handoffs, disagreements, and verification.

The target and all results bind the same run, round, commit, base commit, and diff. `report.json` binds their exact bytes. The checker recomputes the live Git identity and rejects stale or incomplete evidence.

## Logical lenses and adaptive allocation

The six logical lenses remain stable: `bug`, `design`, `edge`, `reuse`, `quality`, and `efficiency`. Physical processes adapt without dropping logical coverage:

- 6+ slots: one independent reviewer per lens.
- 3–5 slots: keep `bug` and `edge` isolated; distribute remaining lenses evenly.
- 2 slots: `bug + reuse + efficiency`, `edge + design + quality`.
- 1 slot: one sequential reviewer returns six isolated lens sections.

`design` is source-level design-system review only. It is marked not applicable only when the target has no UI source; a rendered Design Critique pass does not replace source inspection. Not-applicable is a routed decision in `target.json`, never an omitted result.

Profiles come from `skills/dev/references/model-profiles.json`. Results record the exact profile, provider, model, and effort observed. Unsupported profile or capacity blocks planning instead of silently changing engines.

## Finding contract

Each signal contains:

- deterministic `id` over file, normalized line range, rule, and normalized evidence references so the same defect found by different lenses converges;
- `category`, `severity`, confidence, file and line range;
- rule, issue, impact, concrete fix, and verification command;
- evidence references with kind and stable locator;
- owner: `review`, `design-critique`, or `qa`;
- disposition: `open`, `resolved`, `dismissed`, or `deferred`;
- `decision_required` and optional rationale.

Review rejects path escapes, nonexistent files, out-of-range lines, unknown categories, vague evidence, duplicate signals from one worker, and findings outside that worker's assigned lenses.

## Merge and disagreement policy

- Same deterministic ID: one canonical finding with all signals retained.
- Confidence: maximum signal confidence; never averaged into false certainty.
- Severity: highest signal severity unless a human decision overrides it.
- Different owners, severities more than one tier apart, incompatible fixes, or mixed open/dismissed dispositions: `disputed`.
- Disputed or decision-required findings cannot be auto-fixed and block a passing report until `decisions.json` records an approver, rationale, and action.
- Similar prose with different deterministic IDs remains separate; semantic guessing does not erase evidence.

## Fix loop

Maximum three rounds. After any source mutation:

1. Commit the fix.
2. Generate a new target for the new HEAD with `round + 1` and a binding to the prior report.
3. Re-run every applicable logical lens against the whole new diff.
4. Record resolution links to prior finding IDs and current verification evidence.

At the cap, unresolved Review-owned P0/P1 or disputed findings produce `blocked`. Product/design decisions block immediately rather than consuming automatic rounds.

## Artifact

Create a shared-foundation HTML report. The first screenful shows outcome, target commit/base, logical-lens coverage, top blocker, fix rounds, and next action. Findings show independent signals, evidence, ownership, dispute state, and verification. The artifact is offline, responsive, accessible, print-safe, and hash-bound to `report.json` plus result evidence.

## Implementation

1. Add `scripts/review-target.js` for Git identity, file inventory, applicability, profile validation, and adaptive allocation.
2. Add `scripts/review-check.js` for strict input validation, deterministic identity, merge/disagreement logic, report verification, and stale-evidence rejection.
3. Add a shared review evidence contract and reviewer brief library under `skills/review/references/`.
4. Replace the monolithic `SKILL.md` procedure with the repository skill contract plus five thick steps: target, dispatch, synthesize, resolve, publish.
5. Add a responsive report template and artifact checks.
6. Update Dev, Ship, command/docs, and gate validation to consume the canonical report.
7. Add deterministic, adversarial, dispatch-parity, resume/staleness, and output-quality fixtures.

## Acceptance

- A current complete six-lens logical review can pass with one, two, three, or six physical reviewers.
- Missing, duplicated, unassigned, stale, malformed, or path-escaping evidence fails.
- Same findings deduplicate without losing reviewer signals.
- Reviewer disagreements remain visible and require an explicit decision.
- A source mutation invalidates the old target/results/report.
- Review cannot pass with an unresolved Review-owned P0/P1, disputed finding, or incomplete logical coverage.
- Design Critique and QA handoffs remain visible but do not let Review claim their verdicts.
- Report HTML passes structural, Chromium viewport, accessibility, offline, and print checks.
- Dev and Ship accept only a current checked review report.
- Sol High and Opus xHigh produce schema-valid results on representative fixtures; blind output-quality scoring shows no regression.
