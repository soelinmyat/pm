# PM Telemetry Reference

Telemetry is automatic. Hooks capture run lifecycle, agent dispatches, and
workflow phase/stage spans — skills do not instrument anything. The only
contract a workflow carries is keeping its state-file fields current.

## Enable analytics

Analytics are opt-in. A project enables them with:

```yaml
---
analytics: true
---
```

in `.claude/pm.local.md`. The logger also respects `PM_ANALYTICS=1` for testing.

## Files written

Analytics files are append-only JSONL streams, partitioned per host so multiple
machines can write into the same shared storage repo without git conflicts.
The `<host_id>` is taken from `PM_HOST_ID`, then the `host_id` field in
`pm.config.json` / `.pm/config.json`, then `os.hostname()` (sanitized).

- `<pmStateDir>/analytics/activity-<host_id>.jsonl` — run-level events such as `invoked`, `started`, and `completed`
- `<pmStateDir>/analytics/steps-<host_id>.jsonl` — step spans with timing and lightweight metadata

`<pmStateDir>` is resolved by `scripts/resolve-pm-dir.js` and points at the
storage repo's `.pm/` (typically the kb sibling). Writers must never compose
the path from `process.cwd()` directly — that's how worktree fragmentation
crept in historically. Readers should fold all `activity-*.jsonl` /
`steps-*.jsonl` files together via `lib/analytics-paths.js#listHostFiles`.

## What the hooks capture

- **Run lifecycle** — each `pm:` skill invocation emits `run-start` (PostToolUse
  `analytics-log`), recording `.current-run`/`.current-skill` for span
  correlation. The run is closed on explicit completion (`state-telemetry`) or
  at session end (`session-end`). No manual calls needed.
- **Agent dispatches** — every Agent tool call logs a step span
  (`hooks/agent-step`): `actor: agent:{persona}`, prompt/result character
  counts, correlated to the active run. Estimates reflect orchestrator I/O
  only, not the agent's internal consumption.
- **Workflow phases/stages** — Write/Edit hooks (`state-pre`/`state-step`)
  diff `.pm/groom-sessions/*.md` and `.pm/dev-sessions/*.md` writes and close
  the previous phase/stage span automatically. The final open span closes when
  the run changes or the session ends.

## State-file contract

The automatic layer depends on stateful workflows keeping these fields current:

```yaml
run_id: "{PM_RUN_ID}"
started_at: YYYY-MM-DDTHH:MM:SSZ
completed_at: null | YYYY-MM-DDTHH:MM:SSZ
phase_started_at: YYYY-MM-DDTHH:MM:SSZ   # groom
stage_started_at: YYYY-MM-DDTHH:MM:SSZ   # dev/review/ship
```

- Groom: `phase`, `run_id`, `phase_started_at`, `completed_at`
- Dev/review/ship: `Stage`, `Run ID`, `Stage started at`, `Completed at`

For rare substeps not represented in a state file, `scripts/pm-log.sh step`
still accepts manual spans — see its `--help`.
