# PM Behavioral Evals

This directory contains committed behavioral scenarios for the PM plugin itself.
The suite answers whether PM workflows are being followed by agents, without
rewriting those workflows in the same change.

## Static Check

Run the CI-safe validator:

```bash
npm run eval:check
```

The static check validates scenario shape, shell safety rules, and the sentinel
baseline ledger. It does not call a model, does not need API credentials, and is
safe to run in CI.

## Local Runs

Live runs are opt-in only and write raw output under `eval-results/`, which is
gitignored:

```bash
node scripts/evals/run.js evals/scenarios/dev-review-before-push --agent stub
```

Raw run artifacts can contain sensitive agent output. Keep them local unless a
specific sanitized artifact is intentionally shared for review.

## Scenario Shape

Each v1 scenario has exactly three files:

- `story.md` describes the role, user message, stop condition, and acceptance
  criteria.
- `setup.sh` creates disposable fixtures inside the run workdir and must be
  executable.
- `checks.sh` defines only `pre()` and `post()` functions and must not be
  executable.

`checks.sh` uses helper functions from `scripts/evals/prelude.sh`. Missing
transcripts or malformed helper output produce `indeterminate`, not `pass`.

## Verdicts

Verdicts are one of:

- `pass`: deterministic post-checks passed.
- `fail`: deterministic post-checks failed.
- `skip`: an adapter or sandbox requirement is unsupported before scenario
  shell starts.
- `indeterminate`: harness, transcript, containment, source identity, or
  resource uncertainty prevents a reliable verdict.

Live runs never run in public CI. CI only runs the static validator and
stub-backed unit tests.

## Adding A Scenario

1. Create `evals/scenarios/<slug>/story.md`, `setup.sh`, and `checks.sh`.
2. Make `setup.sh` executable and leave `checks.sh` non-executable.
3. Keep shell assertions helper-mediated; do not emit raw helper frames.
4. Run `npm run eval:check`.
5. Add or update a sanitized baseline row when the scenario joins the sentinel
   suite.
