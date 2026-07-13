---
name: review
description: "Evidence-bound source review after implementation. Use when the user says review this diff, code review, run review, check this branch, inspect the PR, find bugs, simplify this change, or when pm:dev/pm:ship requires the review gate. Plans six logical lenses across available reviewers, validates structured findings, deduplicates signals, resolves disagreement, runs bounded fix rounds, and publishes JSON plus HTML evidence. Do not use for rendered visual critique (use pm:design-critique) or live functional QA."
---

# Review

## Purpose

Review the exact current branch diff for source correctness, contracts, tests, reuse, maintainability, efficiency, and source-level design-system violations. Produce a commit-bound `target.json`, reviewer results, canonical `report.json`, and readable `report.html` that Dev and Ship can verify without trusting a prose claim.

## Iron Law

**NEVER PASS REVIEW FROM UNBOUND, INCOMPLETE, OR STALE REVIEWER EVIDENCE.**

## When NOT to use

- For rendered hierarchy, density, responsive craft, or print presentation, use `pm:design-critique`.
- For live flows, navigation, integrations, and runtime state transitions, use QA inside `pm:dev`.
- Before implementation is committed; Review binds committed Git diff bytes.
- For product scope or architecture approval; return those decisions to Groom/RFC or the user.
- For the same HEAD when a checked `report.json` and gate row already pass current validation.

**Workflow:** `review` | **Telemetry steps:** `target`, `dispatch`, `synthesize`, `resolve`, `publish`

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution, telemetry, and custom instructions.
Read `${CLAUDE_PLUGIN_ROOT}/references/writing.md` before generating any output.

## Ownership

| Gate | Owns |
|---|---|
| Review | Source correctness, contracts, tests, reuse, maintainability, efficiency, source-level design-system compliance |
| Design Critique | Rendered hierarchy, density, responsive/print craft, presentation accessibility |
| QA | Live behavior, navigation, state transitions, integrations, runtime recovery |

Review may create Design Critique or QA handoffs. Those handoffs stay visible but cannot block or pass Review.

## Status definitions

- `passed` — every applicable logical lens is current; no unresolved Review-owned high/critical finding, no unresolved disagreement.
- `failed` — current evidence contains Review-owned high/critical blockers that require a source fix and another round.
- `blocked` — disagreement, decision-required work, deferred blocker, missing capability, or round cap prevents a safe verdict.

## Workflow

Execute the ordered files in `${CLAUDE_PLUGIN_ROOT}/skills/review/steps/`. Resolve a same-named `.pm/workflows/review/` override first. Read the step's `requires` files before acting. Do not replace the scripts with a hand-written summary.

1. `01-target.md` — freeze Git identity, route logical lenses, and plan reviewer allocation.
2. `02-dispatch.md` — dispatch the planned read-only reviewers and collect exact JSON.
3. `03-synthesize.md` — validate, deduplicate, retain signals, and expose disagreement.
4. `04-resolve.md` — apply only safe fixes or explicit decisions; create a new complete round after mutation.
5. `05-publish.md` — publish and check the canonical machine and human reports, then update the gate row.

Detailed schemas and identity rules live in `references/evidence-contract.md`. Reviewer calibration and JSON output live in `references/reviewer-briefs.md`.

Resolve session paths with `deriveSessionSlug` from `scripts/lib/session-slug.js`: a branch such as `codex/pm-dev-workflow-proposal` uses the slug `pm-dev-workflow-proposal`.

## Red Flags — Self-Check

- **"Six lenses require six processes."** Logical coverage is fixed; physical reviewers adapt to available capacity through `review-target.js`.
- **"The finding sounds similar, so I can merge it."** Only deterministic identity merges signals; semantic guessing can erase evidence.
- **"Confidence above 80 means the fix is safe."** Auto-fix also requires Review ownership, no dispute/decision, and `fix_kind: mechanical`; independently derive trusted checks because reviewer verification text is never executable.
- **"Design Critique passed, so source design review is redundant."** Rendered craft and source-level design-system compliance are different ownership domains.
- **"I fixed the blocker, so the old results still count."** Any source mutation changes HEAD and invalidates the whole target/results/report chain.
- **"I can start a fresh run to get three more rounds."** A Dev decision version has one unfinished lineage; changing `run_id` never resets its remediation budget.
- **"A reviewer called it dismissed, so I can ignore it."** Reviewer signals cannot dismiss findings; only a target-bound human decision with approver, rationale, and timestamp can do that.

## Escalation paths

- Product or architecture decision: "Review found a decision outside source-quality authority: {issue}. Return to {pm:groom|pm:rfc} or decide explicitly before continuing."
- Reviewer disagreement: "Reviewers disagree on {finding}. Record an approver, action, and rationale in `decisions.json`; I will not choose silently."
- Three rounds without convergence: "Review reached its three-round cap. The current report preserves remaining blockers at {report_path}; human direction is required."
- Missing safe reviewer runtime: "The configured profile cannot provide structured read-only review safely. Switch/fix the profile or run the planned lenses inline-sequentially."

## Common rationalizations

| Rationalization | Reality |
|---|---|
| "I already inspected the diff while implementing." | Implementation context is not independent, structured review evidence. |
| "This is only a small task." | Route may reduce physical reviewers, never evidence freshness or required logical coverage. |
| "Reusing old results saves time." | Result bindings intentionally fail after any commit or diff change. |
| "A handoff to QA means Review failed." | Handoffs are non-overlapping ownership, not Review blockers. |
| "One aggregate verdict is enough." | Each assigned lens needs its own clean/findings verdict and summary. |
| "A new run ID gives the reviewers a clean slate." | It also evades the three-round cap. Continue the active lineage or obtain explicit direction that advances the Dev decision version. |

## Before marking done

- [ ] `runs/{run-id}/round-{N}/target.json`, every planned result, and the round report are preserved; a pass also publishes canonical `review/report.json` and `review/report.html`.
- [ ] The user confirmed the implementation scope, or the Dev/RFC session supplies it.
- [ ] `review-check.js` passes against current HEAD and the authoritative remote base.
- [ ] All applicable logical lenses have exact verdict coverage; disputes and decisions are explicit.
- [ ] Review-owned blockers are resolved in a new complete round or the gate is reported failed/blocked.
- [ ] The HTML artifact passes structural, locally observed browser viewport, accessibility, offline, and print checks.
- [ ] The `review` gate row points to the current checked report without deleting other gate rows.
