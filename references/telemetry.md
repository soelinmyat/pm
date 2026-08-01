# PM Telemetry Reference

Telemetry is automatic. Hooks capture run lifecycle and agent dispatches, and
the v2 session scripts (`dev-session.js`, `groom-session.js`,
`rfc-session.js`) emit phase spans and genuine completion terminals from the
state-mutation choke point — skills do not instrument anything. For legacy
state-file workflows, the only contract is keeping the state-file fields
current.

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

## What gets captured

- **Run lifecycle** — each `pm:` skill invocation emits `run-start` (PostToolUse
  `analytics-log`), recording `.current-run`/`.current-skill` for span
  correlation. If a previous run is still open, it is soft-closed as
  `superseded` first and the new run records `parent_run_id`, so no run can
  leak without a terminal event. A run is closed genuinely by its session
  script or `state-telemetry` (status `completed`), or at session end
  (`session-end`, status `abandoned`). No manual calls needed.
- **Agent dispatches** — every Agent tool call logs a step span
  (`hooks/agent-step`): `actor: agent:{persona}`, prompt/result character
  counts, correlated to the active run. Estimates reflect orchestrator I/O
  only, not the agent's internal consumption.
- **Workflow phases and completion (v2 session scripts)** —
  `scripts/lib/telemetry.js` is called by `dev-session.js`,
  `groom-session.js`, and `rfc-session.js` after every non-idempotent state
  mutation. It emits one step span per recorded phase result (step = phase
  name, status from the result envelope, attempt preserved), an activity
  `blocked` event when a session becomes blocked, and a genuine `completed`
  terminal when the session reaches a terminal status (`complete`, and
  `handoff` for dev). Run binding is kept per workflow+slug in
  `.pm/analytics/.run-map.json`, so a nested sub-skill invocation cannot
  re-attribute the parent workflow's spans.
- **Legacy state-file workflows** — Write/Edit hooks (`state-pre`/`state-step`)
  diff markdown/state-file writes and close the previous phase/stage span
  automatically.

## Run terminal statuses — reader contract

A run's terminal is the **last** `completed` event for its `run_id`:

- `status: completed` — genuine workflow completion (session script or
  state-telemetry). Authoritative; it may follow an earlier `superseded`
  soft-close of the same run.
- `status: superseded` — soft-close written by `analytics-log` when a new
  skill invocation replaced a still-open run. `detail` records
  `superseded-by={skill}`.
- `status: abandoned` — closed by `session-end` with the session exiting while
  the run was still open (`detail: session-end`).

`event: blocked` records are non-terminal: a blocked session can be resumed
and later complete.

## Known limitations — run attribution

- **Sub-skill dispatch attribution** — while a nested sub-skill
  (`ship` → `pm:review`) owns `.current-run`, agent dispatch spans attribute
  to the sub-skill's run rather than rolling up under the parent. Use
  `parent_run_id` on the sub-skill's `started` event to roll up.
- **One engagement, one run** — a workflow that spans several sessions
  (grooming approved days later) produces one run per engagement, bound to
  the same workflow slug via `meta.workflow_run_id`. Roll up on
  `meta.workflow_run_id` for whole-workflow timing.
- **Review/ship/design-critique completion** — these lanes have no session
  script yet, so their runs still close only via `superseded`/`abandoned`
  soft terminals unless state-telemetry observes a state-file completion.

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
