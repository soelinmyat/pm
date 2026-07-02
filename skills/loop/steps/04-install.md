---
name: Install
order: 4
description: First-time scheduler setup — wire launchd/cron to the loop worker for this project
---

## Goal

Set up unattended wakes for a project: verify config and gates, generate the
scheduler asset (launchd on macOS, cron elsewhere), and install it only with
explicit user confirmation.

## How

1. Initialize loop config if missing, then show it:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/loop-config.js --pm-dir "$(node ${CLAUDE_PLUGIN_ROOT}/scripts/resolve-pm-dir.js "$PWD")" --init
```

2. Walk the user through the pre-install checklist. Do not install until each
   item is confirmed:

- **Gates:** unattended implementation requires `autonomy.start_dev: true`
  (project-level) and `implementation_approved: true` + `approved_by` +
  `approved_at` on each card (per-item). Leaving `start_dev: false` means
  scheduled wakes stay observation-only — a valid first configuration.
- **Engine:** `worker.engine` (`codex` | `claude`) or `worker.engine_bin` must
  name a CLI that is installed, authenticated, and on PATH.
- **Worktree bootstrap:** list the project's gitignored-but-required files
  (env files, generated specs) in `worker.bootstrap_files`; use
  `worker.bootstrap_command` for install steps. Fresh-worktree test failures
  are the most common unattended-run failure.
- **Budgets:** review `budgets.max_runs_per_day` and
  `max_runtime_seconds_per_run`. Every engine run costs real money.
- **Kill switch:** show how to halt everything:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/loop-install.js --project-dir "$PWD" --stop    # halt (commits + pushes)
node ${CLAUDE_PLUGIN_ROOT}/scripts/loop-install.js --project-dir "$PWD" --resume  # resume
```

3. Generate the scheduler asset and show it to the user before installing:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/loop-install.js --project-dir "$PWD"
```

4. Only after the user confirms, install (macOS writes the LaunchAgent and
   loads it; Linux users add the printed line via `crontab -e`):

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/loop-install.js --project-dir "$PWD" --install
```

The interval comes from `scheduler_interval_minutes` (default 30) or
`--interval <minutes>`.

## Done-when

Either the scheduler is installed and the user knows the interval, log path,
and kill-switch command — or the user deliberately stopped at generate-only,
and knows exactly what remains to enable unattended wakes.

**Advance:** stop. The loop skill is complete for this invocation.
