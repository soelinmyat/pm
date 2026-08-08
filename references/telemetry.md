# PM Telemetry Reference

Telemetry is automatic. It has two explicit identities:

- **Workflow** — the canonical v2 `session.run_id` for Dev, Groom, and RFC.
  Session scripts emit its start, phase spans, blockers, and one idempotent
  completion terminal.
- **Engagement** — one host-session-scoped `pm:*` skill invocation. Hooks emit
  engagement starts, parentage, agent dispatches, and session-end terminals.

Never infer workflow completion from engagement status. Skills do not
instrument either stream manually. Legacy state-file workflows retain their
state-file completion contract.

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
- `<pmStateDir>/analytics/.workflow-runs/<workflow_run_id>.json` — private,
  lock-protected idempotency state for canonical workflows; readers do not
  treat these files as events

Hook correlation scratch is source-local and partitioned by the host runtime's
session ID:

- `<sourceDir>/.pm/analytics/sessions/<host_session_id>/engagements.json`
- `<sourceDir>/.pm/analytics/sessions/<host_session_id>/agent-starts/`

No project-global `.current-run` participates in normal hook correlation.
Concurrent sessions and worktrees therefore cannot overwrite or close one
another's engagement state. The legacy global markers remain a fallback only
when a host omits both `session_id` and `transcript_path` from hook payloads.

`<pmStateDir>` is resolved by `scripts/resolve-pm-dir.js` and points at the
storage repo's `.pm/` (typically the kb sibling). Writers must never compose
the path from `process.cwd()` directly — that's how worktree fragmentation
crept in historically. Readers should fold all `activity-*.jsonl` /
`steps-*.jsonl` files together via `lib/analytics-paths.js#listHostFiles`.

## What gets captured

- **Engagement lifecycle** — each `pm:` skill invocation emits an engagement
  `started` event with `meta.identity_kind=engagement` and
  `meta.host_session_id`. The current engagement in that host session becomes
  `parent_run_id`; it is not closed merely because a nested skill starts.
  `session-end` closes every still-open engagement owned by that host session
  as `abandoned` and cannot touch another session's state.
- **Agent dispatches** — every Agent tool call logs a step span
  (`hooks/agent-step`): `actor: agent:{persona}`, prompt/result character
  counts, correlated to the active run. Estimates reflect orchestrator I/O
  only, not the agent's internal consumption.
- **Workflow phases and completion (v2 session scripts)** —
  `scripts/lib/telemetry.js` is called by `dev-session.js`,
  `groom-session.js`, and `rfc-session.js` at initialization and after every
  non-idempotent state mutation. The activity `run_id` is exactly the
  canonical `session.run_id`; records carry `meta.identity_kind=workflow` and
  `meta.workflow_run_id`. A shared registry deduplicates starts, phase results,
  blockers, and terminals when main-checkout and worktree copies attempt to
  report the same canonical session.
- **Legacy state-file workflows** — Write/Edit hooks (`state-pre`/`state-step`)
  diff markdown/state-file writes and close the previous phase/stage span
  automatically.

## Identity and terminal status — reader contract

Group workflow outcomes by records where `meta.identity_kind=workflow`, using
`run_id` (equal to `meta.workflow_run_id`) as the stable key. There is exactly
one authoritative `completed` terminal for a canonical v2 workflow.

Group host interaction spans separately where
`meta.identity_kind=engagement`. Engagement parentage describes nested skill
use inside one host session; it does not redefine workflow ownership.

A run's terminal is the **last** `completed` event for its `run_id`:

- `status: completed` — genuine workflow completion (session script or
  state-telemetry). Authoritative for workflow identities. Historical data may
  contain an earlier `superseded` soft-close from a legacy writer; new writers
  never create that sequence.
- `status: abandoned` — an engagement was still open when its owning host
  session ended (`detail: session-end`). It is not evidence that a canonical
  workflow failed.

`superseded` is a legacy terminal. New writers never use a nested skill load
as a terminal event.

`event: blocked` records are non-terminal: a blocked session can be resumed
and later complete.

## Known limitations

- **Agent attribution** — an agent dispatch belongs to the current engagement
  in its host session. Roll it up through engagement `parent_run_id`; do not
  attach it to a workflow unless a consumer has an explicit workflow binding.
- **Review/ship/design-critique completion** — these lanes have no session
  script yet, so hooks represent them as engagements rather than canonical
  workflows. They close at host session end unless a future owning session
  lifecycle emits an explicit workflow terminal.
- **Legacy hosts without session identity** — hook payloads that omit both
  `session_id` and `transcript_path` share the `legacy` fallback. This keeps
  older hosts working but cannot make concurrent legacy sessions safe.
- **Sensitive arguments** — engagement `detail` may contain user-supplied
  command context. Keep raw JSONL local; any export must select and redact
  fields rather than upload streams verbatim.

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
