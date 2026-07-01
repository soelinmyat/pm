---
type: plan
title: PM Dev Workflow Hardening
created: 2026-07-01
updated: 2026-07-01
status: drafted
groom_tier: standard
proposal: proposal-2
related:
  - docs/plans/2026-07-01-pm-behavioral-evals.md
  - docs/plans/2026-07-01-pm-behavioral-evals-rfc.md
  - https://github.com/obra/superpowers
  - https://github.com/obra/superpowers/releases
---

# PM Dev Workflow Hardening

> **Decision:** Harden PM's own `/pm:dev` path.
> Borrow Superpowers' useful discipline, but keep PM-native product flow and
> make the behavioral evals the merge gate.

## TL;DR

- **For** - PM plugin maintainers who need agents to follow dev, review, TDD,
  and UI gates without manual babysitting.
- **What** - A targeted hardening pass over `/pm:dev`, `/pm:review`, and
  design critique gates: gate manifests, pre-push refusal, PM-native design
  critique, review evidence, and eval score updates.
- **Why now** - Proposal 1 added sentinel evals and found two P1 workflow
  failures: UI design critique can be skipped, and review can be skipped before
  push or ship handoff.

**Current sentinel baseline.**

| Status | Count |
|---|---:|
| pass | 2 |
| fail | 2 |
| indeterminate | 1 |
| skip | 0 |

Baseline pass rate is 40%. Determinate pass rate is 50%. The failing rows are
`dev-ui-design-critique-required` and `dev-review-before-push`.

## Execution Contract

Agents execute from this block. If it conflicts with later prose, revise the
prose before approval.

| Field | Contract |
|---|---|
| **Scope** | Patch PM's dev workflow so required gates are first-class, recorded, and enforced before push. Add a gate manifest or equivalent structured state. Make UI design critique PM-native. Make every review path write an attestation tied to the current commit. Capture TDD red/green evidence. Update docs and eval baselines. |
| **Non-goals** | Do not replace PM with Superpowers. Do not rewrite groom, research, RFC, loop, or the eval harness. Do not add a hosted eval dashboard. Do not require live evals in public CI. Do not add broad agent matrices. |
| **Primary files** | `skills/dev/SKILL.md`, `skills/dev/steps/05-implementation.md`, `skills/dev/steps/07-review.md`, `skills/dev/steps/08-ship.md`, `skills/dev/references/implementation-flow.md`, `skills/dev/references/tdd.md`, `skills/review/SKILL.md`, `skills/ship/SKILL.md`, `skills/ship/steps/03-review.md`, `commands/dev.md`, `commands/review.md`, `commands/ship.md`, `scripts/evals/check.js`, `evals/baselines/sentinel.json`, `.githooks/pre-push`, runtime `hooks/` if tool-use enforcement is added, and targeted tests under `tests/`. |
| **Likely new files** | `scripts/dev-gate-check.js`, `evals/results/proposal-2.json`, `skills/design-critique/SKILL.md` or a PM-native design critique step, `commands/design-critique.md` if exposed, tests for gate manifest parsing and push refusal. If a command or skill is added, update `plugin.config.json` and generated platform manifests via the existing generator/bump flow. |
| **Acceptance gate** | Keep `evals/baselines/sentinel.json` as the immutable current-behavior baseline. Add a separate Proposal 2 current-results ledger. All P1 sentinel failures in the current-results ledger must be `pass`. Existing baseline `pass` rows must stay `pass` in current results. `review-catches-planted-bug` must become determinate `pass` if the live adapter is eligible; otherwise it may remain `indeterminate` only with an explicit adapter blocker and no current-results `fail` rows. |
| **Required commands** | `npm run eval:check`, targeted unit tests for changed scripts, `npm test`, and `npm run validate:plugin`. |
| **Release rule** | Update manifests only through `npm run bump patch` as the final branch commit before PR. After squash merge, delete/recreate the version tag on the `main` merge commit and force-push that tag, matching `AGENTS.md` tag placement rules. |

## Problem & Context

PM already contains strong instructions. The failure is that key behaviors are
too easy for an agent to skip under pressure.

The new eval baseline makes this concrete:

- `dev-ui-design-critique-required` is a current fail because visual review
  evidence is missing in the PM dev flow.
- `dev-review-before-push` is a current fail because review can be skipped
  before ship handoff.
- `dev-tdd-before-implementation` and `skill-description-body-read` currently
  pass, so Proposal 2 must preserve those behaviors while fixing the failures.

For this proposal, a **P1 sentinel failure** means any committed sentinel row
with status `fail`. P0 remains reserved for unsafe harness behavior, data loss,
or a workflow that can merge code while known gates are explicitly failed.

Current runtime files show the same risk:

- `skills/dev/steps/07-review.md` treats design critique as conditional on an
  external `/design-critique` skill being available.
- `skills/dev/steps/07-review.md` skips code review for S-sized proposal work
  because `pm:simplify` is considered enough.
- `pm:ship` has a review attestation gate, but `/pm:dev` and standalone paths
  need the same hard refusal before any push or PR action.
- TDD is an Iron Law, but the workflow does not consistently produce durable
  red/green evidence that evals and later recovery agents can inspect.

## Research

### Local PM Baseline

Proposal 1 created a PM-native eval harness under `evals/` and `scripts/evals/`.
It records five sentinel scenarios in `evals/baselines/sentinel.json`.

The most important finding is not the absolute score. It is the shape of the two
failures:

1. PM has instructions for UI critique, but no dependable PM-native gate.
2. PM has review instructions, but review attestation is not enforced across
   every path that can push or hand off to ship.

### Superpowers Prior Art

Superpowers is useful as a pattern library, not as a drop-in dependency.

Current docs describe a coding-agent workflow that starts with intent discovery,
turns that into a spec, builds a detailed plan, then runs subagent-driven
development, TDD, review, and branch finishing as mandatory workflows. The same
README says behavior tests live under `evals/`, separate from plugin
infrastructure tests.

Recent Superpowers release notes sharpen the relevant lessons:

- Keep per-session bootstrap lean; behavior-shaping content must earn its token
  cost.
- Do not rely on Codex session-start hooks when native skill triggering is
  reliable.
- Use evals to compare behavior across harnesses.
- Move reviewer inputs and implementation reports into files so controllers do
  not keep expensive pasted context forever.
- Make reviewers read-only and skeptical. Controllers must not coach reviewers
  to ignore findings or pre-rate severity.

**PM implication:** adopt the small, enforceable mechanics. Do not import
Superpowers wholesale.

## Users & JTBD

**Primary JTBD.** When I ask PM to implement work, I want required quality gates
to run and record evidence automatically, so I can trust a merged PR without
manually auditing the conversation.

**Primary user.** PM plugin maintainer working in this source repo.

**Secondary user.** PM plugin user who wants `/pm:dev` to behave consistently
across Claude, Codex, and future harnesses.

## Scope

**In scope**

- A PM-native gate manifest or structured state section that records:
  - TDD red/green evidence
  - simplify result or skip reason
  - design critique result or skip reason
  - QA result or skip reason
  - review result tied to commit SHA
  - final verification command and result
- A pre-push and pre-ship refusal rule:
  - if a required gate is missing for the current commit, stop and run it
  - do not rely on recalled test or review output
- A PM-native design critique path:
  - use existing `skills/dev/references/design-critique*.md`
  - stop depending on an external `/design-critique` skill for PM's own gate
  - write a durable critique artifact or state entry
- Review hardening:
  - every non-doc code change gets either lightweight code scan or `pm:review`
  - every review path writes `Review gate: passed (commit <sha>)`
  - reviewer inputs are saved as files or structured state where practical
  - reviewers are read-only and cannot be coached to suppress findings
- TDD evidence capture:
  - record the failing test command and passing test command
  - allow explicit skip reasons only for docs/config/generated-code cases
- Eval updates:
  - update sentinel scenarios only if needed to check real behavior
  - keep `evals/baselines/sentinel.json` as the pre-fix baseline
  - add a Proposal 2 current-results ledger, such as
    `evals/results/proposal-2.json`
  - update `scripts/evals/check.js` and tests so result ledgers validate without
    the baseline-only "must include a current fail" rule
  - document any remaining `indeterminate` reason

**Out of scope**

- Replacing PM's product lifecycle with Superpowers' brainstorming/planning
  workflow.
- Rewriting `/pm:groom`, `/pm:rfc`, `/pm:ship`, or `/pm:loop` beyond the
  interface needed for dev gate enforcement.
- Adding live evals to public CI.
- Adding a hosted eval dashboard.
- Changing plugin packaging or marketplace behavior beyond normal version bump.
- Writing consumer-project `pm/` or `.pm/` artifacts in this source repo.

**10x filter result:** gap-fill. Superpowers proves the pattern. PM needs the
same discipline applied to its product-aware workflow and measured by its own
sentinels.

## Functional Requirements

### 1. Gate Manifest

Add one structured place where the dev session records every quality gate.

Acceptable shapes:

- a `## Gate Manifest` section in `.pm/dev-sessions/{slug}.md`
- a sidecar `.pm/dev-sessions/{slug}.gates.json`
- a structured YAML block in the existing state schema

Minimum fields per gate:

| Field | Meaning |
|---|---|
| `name` | `tdd`, `simplify`, `design-critique`, `qa`, `review`, `verification` |
| `status` | `passed`, `skipped`, `failed`, `blocked` |
| `commit` | commit SHA the gate applies to, when applicable |
| `artifact` | path to evidence, report, or transcript-derived artifact |
| `reason` | required for `skipped`, `failed`, or `blocked` |
| `checked_at` | ISO timestamp |

The manifest must be updated after every gate. A stale commit SHA means the gate
does not apply to the current branch tip.

### 2. Pre-Push Refusal

Add a shared executable gate checker, for example `scripts/dev-gate-check.js`.
This must be the implementation point for push and ship refusal, not just prose
inside step files.

Before PM-mediated `git push`, `gh pr create`, or `pm:ship`, PM must run the
checker against the current commit. If the checker fails, the workflow stops and
runs or fixes the missing gate.

Required behavior:

- If a code change lacks review attestation, run the correct review path.
- If a UI change lacks design critique or an explicit valid skip reason, run
  PM-native design critique.
- If tests were not run after the last code change, run verification.
- If TDD evidence is missing for a code behavior change, stop unless the change
  is docs-only, config-only, generated-only, or explicitly exempted.

This rule applies to `/pm:dev`, standalone `/pm:ship`, and recovery agents.
`pm:ship` must not treat a green PR as proof that review happened. It must read
the same gate state or re-run review before push or merge.

For this source repo, wire the checker into `.githooks/pre-push` as a backstop.
If runtime tool-use hooks can detect `git push` or `gh pr create` reliably, wire
the same checker there too. If a runtime cannot enforce raw shell pushes, say so
explicitly and scope the guarantee to PM-mediated push and ship paths.

### 3. PM-Native Design Critique

Design critique must not depend on an external skill being discoverable.

Recommended implementation:

1. Add a first-class PM skill, `pm:design-critique`, backed by existing
   `skills/dev/references/design-critique*.md`.
2. Keep `/pm:dev` Step 07 as the caller, but have it invoke PM's own skill or
   inline the PM-native reference when runtime delegation is unavailable.
3. Write a durable artifact such as:
   - `/tmp/design-review/{feature}/manifest.json`
   - `.pm/dev-sessions/{slug}.design-critique.json`
   - a `Design critique: passed` entry in the gate manifest
4. Re-run after P0/P1 fixes and tie the final result to the current commit.

Valid skip reasons:

- no UI file changes
- generated UI only with no visual behavior change
- environment blocked after documented setup attempt

Invalid skip reasons:

- skill not available
- no time
- tests passed
- reviewer was already "kind of" satisfied

### 4. Review Attestation For Every Push Path

Every path that can push must share one rule: no current review attestation, no
push.

Size routing can still differ:

| Size/kind | Review path |
|---|---|
| XS | lightweight code scan |
| S proposal | lightweight code scan unless simplify produces equivalent structured finding evidence |
| task/bug | `pm:review` |
| M/L/XL | `pm:review` |
| docs/config only | explicit skip attestation |

The important part is not that every change runs the full three-agent review.
The important part is that every change records a current, inspectable review
decision before push.

### 5. TDD Evidence

The TDD rule should keep its current strength and add durable evidence.

For code behavior changes, record:

- failing test command
- failing output summary
- implementation files changed after red
- passing test command
- passing output summary
- commit SHA after green/refactor

If the workflow cannot produce a red phase, it must record why. "Test already
existed" is acceptable only when the agent can name the existing failing or
regression test that covers the change.

### 6. Review Package Hardening

Align PM review mechanics with the useful Superpowers v6 lessons.

Requirements:

- Write reviewer inputs to files or structured state when diff/context is large.
- Reviewers are read-only. They do not edit the branch.
- Controller prompts must not tell reviewers to ignore a finding or pre-rate a
  concern as minor.
- Findings must cite file and line when possible.
- The controller may discard a finding only after verifying the referenced code
  or pattern does not exist.

### 7. Documentation And Command Alignment

Update public and runtime surfaces together:

- `commands/dev.md`
- `commands/review.md`
- `commands/ship.md`
- `plugin.config.json` and generated platform manifests if a new command or
  skill becomes public
- `README.md` if the user-facing promise changes
- `.codex/INSTALL.md` only if install or invocation guidance changes
- tests that enforce the new hard gates and section wording

Descriptions should trigger the skill, not summarize the workflow so completely
that agents can shortcut the body.

## Implementation Plan

### Phase 0 - Re-run The Baseline

- Run `npm run eval:check`.
- Run every sentinel with the best available adapter.
- If live Codex remains ineligible, document why and use the committed baseline
  rows as the score floor.
- Record the run command, adapter, artifact path, and verdict in the proposal
  PR description so reviewers can compare before/after behavior.

### Phase 1 - Gate Manifest And Pre-Push Refusal

- Define the manifest schema.
- Add `scripts/dev-gate-check.js` as the shared enforcement point.
- Update `/pm:dev` Step 07 and `/pm:ship` review checks to invoke it.
- Wire the checker into `.githooks/pre-push` for this source repo.
- Add unit tests for stale SHA, missing review, missing verification, and valid
  docs-only skip.
- Add a negative test proving push/ship is blocked when the review entry exists
  but points at an older commit.

### Phase 2 - PM-Native Design Critique

- Create `pm:design-critique` or an equivalent internal PM step.
- Move the existing dev references behind that entrypoint.
- Update `/pm:dev` UI routing so "skill unavailable" is no longer a skip.
- Add tests for UI diff detection and required artifact recording.

### Phase 3 - TDD And Review Evidence

- Add red/green evidence capture to implementation flow.
- Make S-sized work write code-scan or simplify-equivalent review attestation.
- Save review package files for large diffs.

### Phase 4 - Sentinel Pass

- Run all five sentinels.
- Patch the workflow until no P1 sentinel failures remain.
- Write sanitized current results to `evals/results/proposal-2.json`.
- Keep `evals/baselines/sentinel.json` unchanged except for schema migrations
  that preserve the original baseline verdicts.
- Document any remaining `indeterminate` as an adapter/harness issue, not a
  workflow pass.

## Acceptance Criteria

1. `npm run eval:check` passes.
2. `npm test` passes.
3. `npm run validate:plugin` passes.
4. `dev-ui-design-critique-required` has baseline `fail` and Proposal 2 current
   result `pass`.
5. `dev-review-before-push` has baseline `fail` and Proposal 2 current result
   `pass`.
6. `dev-tdd-before-implementation` remains `pass` in Proposal 2 current results.
7. `skill-description-body-read` remains `pass` in Proposal 2 current results.
8. `review-catches-planted-bug` is `pass`, or remains `indeterminate` only
   because the live adapter is still ineligible and the reason names that
   blocker.
9. No Proposal 2 current-results row has status `fail`.
10. PM-mediated push and ship cannot proceed when required gate attestation is
    stale for the current commit; this source repo's pre-push hook also blocks
    stale-gate pushes as a backstop.
11. UI changes cannot skip design critique because an external skill is missing.
12. Every review attestation names the commit SHA it applies to.
13. TDD evidence records a red command before implementation for code behavior
    changes, or records a valid skip reason.
14. Public docs and command descriptions stay aligned with runtime behavior.

## Inline Scope Review

| Reviewer | Verdict | Key note |
|---|---|---|
| Product | Ship it | Directly fixes the two failing P1 sentinels. |
| Competitive | Strengthens | Adopts Superpowers' proven mechanics without copying its whole lifecycle. |
| Engineering | Feasible with caveats | Builds on existing dev references, review skill, and eval harness. |

**Engineering caveats**

- State schema drift is the main risk. Add parser tests before runtime edits.
- Eval result schema drift is a real risk. Preserve the current baseline ledger
  and add a separate current-results ledger.
- UI diff detection can false-positive on generated files. Keep skip reasons
  explicit and testable.
- Design critique should avoid two sources of truth. Prefer one PM entrypoint
  used by both dev and standalone review.
- Do not make S-sized work too expensive. A lightweight code scan attestation is
  enough if it writes structured evidence.
- New command exposure touches manifests. Use the repo generator and bump script;
  do not hand-edit generated platform files.

No blocking issues remain after this review.

## Open Decisions

| Decision | Recommendation |
|---|---|
| First-class skill vs internal-only design gate | Add `pm:design-critique`; it fixes discoverability and keeps a clean user surface. |
| S-sized proposal review depth | Use lightweight code scan attestation unless simplify reports equivalent structured review evidence. |
| Live adapter blocker | Do not block Proposal 2 grooming. Treat live-adapter eligibility as Phase 0 and record exact skip reasons. |
| Gate manifest storage | Prefer a JSON sidecar plus a short markdown summary. The checker and evals need deterministic parsing; humans still need readable state. |
| Eval before/after storage | Keep `evals/baselines/sentinel.json` as the baseline and add `evals/results/proposal-2.json` for current results. |

## Sources

- Superpowers README, accessed 2026-07-01:
  https://github.com/obra/superpowers
- Superpowers release notes, accessed 2026-07-01:
  https://github.com/obra/superpowers/releases
- PM Proposal 1 eval plan:
  `docs/plans/2026-07-01-pm-behavioral-evals.md`
- PM sentinel baseline:
  `evals/baselines/sentinel.json`

## Next Steps

1. Approve this proposal.
2. Generate the RFC for Proposal 2.
3. Implement in small PRs, with each PR updating the Proposal 2 current-results
   ledger while preserving the sentinel baseline.
