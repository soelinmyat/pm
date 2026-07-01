---
type: plan
title: PM Eval Current Score
created: 2026-07-02
updated: 2026-07-02
status: proposed
groom_tier: quick
proposal: proposal-2
related:
  - docs/plans/2026-07-01-pm-behavioral-evals.md
  - docs/plans/2026-07-01-pm-behavioral-evals-rfc.md
---

# PM Eval Current Score

PM should add a first-class current-score command for the behavioral eval
sentinel suite. Proposal 1 built the harness and baseline rows. Proposal 2 makes
the harness useful after behavior changes by running or reading sentinel results
and comparing them to the baseline.

## TL;DR

- **For** - PM plugin maintainers shipping workflow changes.
- **What** - Add a score command that can run the sentinel suite, write a
  sanitized result ledger, and compare current results with the baseline.
- **Why now** - `v1.6.8` repaired dev workflow gates. We need a repeatable way
  to say whether sentinel behavior improved, regressed, skipped, or stayed
  unscorable.

## Decision Brief

Approve a narrow current-score layer over the existing eval harness. Do not
expand live-agent scope. The command must make adapter ineligibility visible,
not hide it. If the Codex adapter still skips for `network-policy`, the score
should say "not comparable" rather than claiming a pass-rate improvement.

## Execution Contract

| Field | Contract |
|---|---|
| **Scope** | Add `scripts/evals/score.js`; add `npm run eval:score`; support `--agent`, `--write`, `--results`, `--baseline`, and `--json`; run all sentinel scenarios when an agent is provided; write sanitized result ledgers under `evals/results/`; compare result rows with `evals/baselines/sentinel.json`; document the score workflow. |
| **Non-goals** | No live Codex implementation; no network allowlist work; no LLM grader; no hosted dashboard; no raw transcript commits; no changes to PM workflow behavior in this proposal. |
| **Acceptance criteria** | 1. `npm run eval:score -- --agent stub --write /tmp/pm-current.json` runs all sentinel scenarios and writes a valid result ledger. 2. `npm run eval:score -- --agent codex --write /tmp/pm-codex.json` records skip rows instead of failing because the live adapter is still ineligible. 3. `npm run eval:score -- --results <ledger>` prints counts for pass, fail, skip, indeterminate, determinate pass rate, comparable baseline rows, improvements, regressions, and not-comparable rows. 4. Result ledgers with all skip rows validate; baseline ledgers keep the stricter "at least three determinate and one fail" gate. 5. `npm run eval:check`, `npm test`, and `npm run validate:plugin` pass. |
| **Edge cases** | Missing baseline reports score without comparison; unknown scenario id fails validation; duplicate result rows fail validation; result ledger with zero determinate rows is valid but marked not comparable; failed scenario runs still write ledger rows; known ineligible adapters create `skip` rows; unknown adapter names fail fast; raw local run artifacts stay under `eval-results/` and remain gitignored. |
| **Success metric** | Maintainer can run one command after a PM workflow change and get an honest current score, including "blocked by adapter safety" when live behavior cannot yet be measured. |

## Problem

Proposal 1 gave us sentinel scenarios and a baseline ledger. It did not give us a
maintainer workflow for the next question:

> "What is the score for the current PM version?"

Today, a maintainer must manually run scenarios one at a time, find verdicts
under `eval-results/`, and mentally compare them to
`evals/baselines/sentinel.json`. That is slow and easy to misreport.

The bigger risk is false confidence. The current Codex adapter intentionally
skips live execution because network allowlisting is not proven. A score tool
must preserve that truth.

## Users

**Primary user:** PM plugin maintainer.

Job: after editing PM workflow behavior, run one command and know whether the
sentinel suite improved, regressed, skipped, or remained unscorable.

## Scope

### 1. Result Ledger Writer

Add `scripts/evals/score.js` with a suite-run mode:

```bash
npm run eval:score -- --agent stub --write evals/results/current.json
npm run eval:score -- --agent codex --write /tmp/pm-codex-current.json
```

Behavior:

- Read sentinel ids from `scripts/evals/check.js` via an exported shared
  constant.
- Run each scenario through `scripts/evals/run.js` / `runEval`.
- Convert each verdict to the existing ledger row shape.
- Write only sanitized rows: no raw transcript, no absolute paths, no secrets.
- Exit non-zero only for harness/ledger write errors, not because a scenario
  verdict is `fail`, `skip`, or `indeterminate`.

### 2. Score Reporter

Add a read-only score mode:

```bash
npm run eval:score -- --results evals/results/current.json
npm run eval:score -- --results evals/results/current.json --json
```

Report:

- Total sentinel rows
- `pass`, `fail`, `skip`, `indeterminate`
- Determinate pass rate: `pass / (pass + fail)`
- Baseline determinate pass rate
- Comparable rows where both baseline and result are determinate
- Improvements: baseline `fail` -> result `pass`
- Regressions: baseline `pass` -> result `fail`
- Newly unscorable rows: baseline determinate -> result `skip` or
  `indeterminate`
- Newly scored rows: baseline `skip` or `indeterminate` -> result determinate

If no rows are comparable, print:

> Current score is not comparable to baseline. All result rows are skipped or
> indeterminate.

### 3. Validation Semantics

Keep baseline validation strict:

- All five sentinel rows required.
- At least three determinate rows required.
- At least one baseline `fail` required.

Relax result ledger validation:

- All five sentinel rows required.
- Rows may all be `skip` or `indeterminate`.
- Score reporter, not static validation, explains whether the result is
  comparable.

### 4. Documentation

Update `evals/README.md` with:

- How to run a current score.
- Why Codex may currently report `skip: network-policy`.
- How to read pass rate versus comparable pass rate.
- What to commit: scenarios and sanitized ledgers only.
- What not to commit: `eval-results/` raw artifacts.

## Non-Goals

- Do not implement a live Codex adapter.
- Do not weaken the network-policy skip.
- Do not claim workflow improvement from static tests alone.
- Do not add LLM grading.
- Do not block PRs on live eval scores.

## Risks

| Risk | Mitigation |
|---|---|
| Users mistake stub score for live Codex behavior | Label output with `agent` and document that `stub` is harness-only. |
| All Codex rows skip and users think the suite is useless | Print "not comparable" and count skipped rows explicitly. |
| Result ledgers become fake evidence | Ledger rows keep agent, status, reason, artifact ref, and timestamp. Raw evidence remains local. |
| Score command fails CI because scenarios fail by design | Scenario `fail` is data, not command failure. Only harness errors fail the command. |

## Success Metrics

| Metric | Before | After |
|---|---|---|
| Current score command | none | `npm run eval:score` |
| Result ledger validation | too strict for all-skip live adapters | validates honest skipped current runs |
| Baseline comparison | manual | printed text and JSON summary |
| Codex live ineligibility | hidden in adapter implementation | visible as score output |

## Next Step

Implement the current-score layer, then run it with both `stub` and `codex`.
Use the resulting output as the kickoff evidence for future live-adapter work.
