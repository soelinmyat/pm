---
name: Work
order: 6
description: Execute one unit of loop work — claim, run a stage, verify its result, and finalize
---

## Goal

Run one worker cycle: select and durably claim the next eligible card, bootstrap
an isolated worktree, execute the configured engine headless, verify its
bounded stage result, record a crash-safe run ledger, and atomically finalize
the canonical outcome with lease deletion.

Claim, dispatch marking, checkpoint/finalization, and release are pushed from
an isolated detached PM Git transaction. They never commit, pull, reset, or
restore the operator's shared PM checkout. Each push uses compare-and-swap
against the fetched upstream OID and fails closed if ownership or the expected
card revision changes.

## How

Preview first (no claim, no execution):

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/loop-worker.js --project-dir "$PWD" --dry-run
```

Execute one unit of work:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/loop-worker.js --project-dir "$PWD"
```

The default mode covers the full lifecycle in priority order (ship cycles for
in-flight PRs first, then new dev work, then rfc/research if their autonomy
dials allow). Pass `--mode dev|ship|research` to restrict a wake to one lane.

The worker refuses to run when:

- `pm/loop/STOP` exists (kill switch — commit and push it to halt every machine),
- the daily run budget is spent — dev/rfc/research runs count against
  `budgets.max_runs_per_day`; ship cycles have their own
  `budgets.max_ship_cycles_per_day` so a slow PR can't starve dev dispatch,
- the card already failed `budgets.max_attempts_per_stage` times at this stage
  (`attempts-exhausted` — the card needs a human look),
- both implementation gates are not true (`autonomy.start_dev` + per-card
  `implementation_approved`/`approved_by`/`approved_at`),
- the lease cannot be committed AND pushed (no durable claim, no dispatch).

Claim atomically writes the lease and
`pm/loop/events/<run_id>.json`. Immediately before engine execution, the worker
durably changes both records to `dispatched`. A validated result can then be
checkpointed in `pm/loop/recovery/<run_id>.json` with the lease phase set to
`finalizing`; finalization writes the terminal event, card and allowlisted
artifacts while deleting recovery and lease in one CAS commit.

Before selecting new work, the next wake reads remote transaction state. It
distinguishes `never-dispatched`, `dispatched-without-terminal-result`,
`recovery-ready`, finalized, and ambiguous runs. Any non-final state returns
`recovery-required` instead of executing the engine again. An expired lease
with recovery remains recovery-only.

Every claimed dispatch writes a ledger — including rejections — so budgets and
the attempts backstop always advance. Worktrees are removed after every run
(ship worktrees especially, so the PR branch is free for the next cycle);
failed dev run branches are deleted; set `worker.keep_workspace: true` to keep
them for debugging.

Engine selection comes from `pm/loop/config.json` → `worker.engine`
(`codex` | `claude`) or `worker.engine_bin` for a custom command. Projects with
gitignored-but-required files (env files, generated specs) must list them in
`worker.bootstrap_files` so fresh worktrees don't fail their first test run.

Each child workflow atomically writes its versioned envelope only through
`PM_LOOP_RESULT_FILE`; it never writes canonical backlog state. Results land in
the cryptographically unique, mode-0700 local directory
`.pm/loop-results/<run_id>/`, with a mode-0600 `result.json`. The worker
validates card/stage/run identity, terminal/artifact combinations, bounds, and
remote PR or document/gate evidence before any success transition. Missing,
malformed, mismatched, or unverified success becomes `failed-contract` and the
card becomes non-dispatchable `needs-human`.

The crash-safe ledger remains at `.pm/loop-runs/<run_id>.json`; bounded engine
logs remain under `.pm/loop-runs/<run_id>/`.

A card's lifecycle spans multiple wakes by design — ship is event-driven
(CI runs, remote review rounds) and cannot finish in one engine run:

- **Implement wake** (`stage: dev`, budget `max_runtime_seconds_per_run`):
  fresh worktree → dev workflow → verified OPEN PR + committed gate sidecar →
  worker updates the card to `status: shipping` + `branch` + `prs`. Never
  merges.
- **Ship wakes** (`stage: ship`, budget `max_runtime_seconds_per_ship_cycle`):
  each wake checks out the existing branch and runs ONE bounded cycle —
  assess CI + new review comments, fix what's actionable, push, stop. Rounds
  of remote review each get absorbed by a subsequent wake. With
  `autonomy.merge_pr: true` the cycle verifies the MERGED PR identity and marks
  the card done; with `false` it parks the green PR as `needs-human` for your
  merge. A `waiting` result preserves `shipping` with a bounded `retry_after`,
  and selectors skip the card until that wake time.

When summarizing the JSON result:

- `completed` — this wake's stage finished cleanly; say which stage and what
  the next wake will do (ship cycle, next sibling, or nothing).
- `failed` / `noop` — the card stays at its pre-claim state while the durable
  outcome event advances retry policy; report the reason and log paths.
- `failed-contract` — the result or verified evidence was unsafe or invalid;
  report the preserved evidence and the `needs-human` remediation.
- `bootstrap-failed` — report the reason and log paths; the pre-claim card state
  is preserved and the failure event is durable while the lease is deleted.
- `recovery-required` — a durable claim, dispatch, recovery checkpoint, or
  ambiguous orphan must be resolved without redispatching the engine.
- `stopped` / `disabled` / `budget-exhausted` / `attempts-exhausted` / `rejected` / `idle` / `blocked` — nothing ran (any lease was released); report why.

This step is complete when the worker has either durably finalized one
validated stage outcome, preserved an authoritative recovery state without
redispatch, or stopped before mutation with an exact reason. Close by telling
the user the outcome, result/log locations, and what needs human attention
next; then end this single-cycle workflow.
