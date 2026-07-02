---
name: Work
order: 5
description: Execute one unit of loop work — claim, bootstrap a worktree, run the engine, release
---

## Goal

Run one worker cycle: select and durably claim the next eligible card, bootstrap
an isolated worktree, execute the configured engine headless, record a
crash-safe run ledger, and release the lease.

## How

Preview first (no claim, no execution):

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/loop-worker.js --project-dir "$PWD" --dry-run
```

Execute one unit of work:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/loop-worker.js --project-dir "$PWD" --mode dev
```

The worker refuses to run when:

- `pm/loop/STOP` exists (kill switch — commit and push it to halt every machine),
- the daily run budget (`budgets.max_runs_per_day`) is spent,
- both implementation gates are not true (`autonomy.start_dev` + per-card
  `implementation_approved`/`approved_by`/`approved_at`),
- the lease cannot be committed AND pushed (no durable claim, no dispatch).

Engine selection comes from `pm/loop/config.json` → `worker.engine`
(`codex` | `claude`) or `worker.engine_bin` for a custom command. Projects with
gitignored-but-required files (env files, generated specs) must list them in
`worker.bootstrap_files` so fresh worktrees don't fail their first test run.

Results land in the local state dir: ledger at `.pm/loop-runs/<run_id>.json`,
engine logs under `.pm/loop-runs/<run_id>/`.

A card's lifecycle spans multiple wakes by design — ship is event-driven
(CI runs, remote review rounds) and cannot finish in one engine run:

- **Implement wake** (`stage: dev`, budget `max_runtime_seconds_per_run`):
  fresh worktree → dev workflow → PR opened → card updated to
  `status: shipping` + `branch` + `prs`. Never merges.
- **Ship wakes** (`stage: ship`, budget `max_runtime_seconds_per_ship_cycle`):
  each wake checks out the existing branch and runs ONE bounded cycle —
  assess CI + new review comments, fix what's actionable, push, stop. Rounds
  of remote review each get absorbed by a subsequent wake. With
  `autonomy.merge_pr: true` the cycle merges when everything is green and
  marks the card done; with `false` it parks the green PR as needs-human for
  your merge.

When summarizing the JSON result:

- `completed` — this wake's stage finished cleanly; say which stage and what
  the next wake will do (ship cycle, next sibling, or nothing).
- `failed` / `timeout` / `bootstrap-failed` — report the reason and log paths;
  the lease was released either way.
- `stopped` / `budget-exhausted` / `idle` / `blocked` — nothing ran; report why.

## Done-when

One worker cycle has run (or been correctly refused) and the user knows the
outcome, where the logs are, and what needs human attention next.

**Advance:** stop after this step unless the user asked for another subcommand.
