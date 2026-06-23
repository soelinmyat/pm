---
type: rfc
title: PM Loop Git-Backed Orchestration
created: 2026-06-23
updated: 2026-06-23
status: draft
related:
  - docs/plans/2026-06-23-loop-engineering-pm-proposal.md
---

# PM Loop Git-Backed Orchestration

> **Decision:** Build PM Loop as a git-backed orchestration layer.
> OpenClaw is the first scheduler adapter. Linear is out of v1.

## Problem

PM has strong one-shot workflows, but it does not yet have a safe way to wake up,
scan work, claim one card, move it forward, and stop.

The loop must work across machines without a server. Git should act as the remote
checkpoint log for durable state. Runtime tools can vary.

## Goals

- Show a Kanban-style board from existing PM artifacts.
- Let a scheduler safely wake PM and claim one card.
- Sync important state changes through git.
- Keep real implementation behind explicit human approval.
- Start with safe loops: status, dry-run wake, stale session checks, and PR babysitting.
- Keep runtime adapters optional: OpenClaw first, launchd/cron/GitHub Actions later.

## Non-Goals

- No Linear dependency in v1.
- No custom server, Redis, or hosted database.
- No auto-implementation of ideas without approval.
- No auto-merge by default.
- No rewrite of `pm:dev`, `pm:ship`, `pm:groom`, or `pm:rfc`.

## Architecture

PM Loop is a thin layer over existing PM skills.

```text
scheduler
  -> pm:loop wake
  -> pull git state
  -> build board
  -> claim one card
  -> dispatch existing PM skill
  -> push checkpoint
  -> release lease or mark blocked
```

The loop owns selection, leases, checkpoints, and policy. Existing skills own the
actual work.

## State Model

Durable state lives in the PM content repo so it syncs through existing `pm:sync`.

```text
pm/loop/
  config.json
  leases/
    PM-123.json
  runs/
    2026-06-23T100000Z-openclaw-vm.json
  events/
    2026-06-23T100000Z-openclaw-vm.jsonl
  session-snapshots/
    example.json
```

Local scratch state stays out of git.

```text
.pm/loop/
  machine-id.json
  tmp/
  logs/
```

Mutating wake commands require configured git sync. If `pm:sync status` cannot
confirm a remote-backed PM repo, `pm:loop wake` may render status and dry-run
selection only. It must not claim work.

Cross-machine board state must be derived from git-synced PM files. `.pm/*`
session files are local runtime state and may only influence the local machine's
display. When a loop run needs a session to be visible across machines, it writes
or updates a compact `pm/loop/session-snapshots/{slug}.json` checkpoint.

### Config

`pm/loop/config.json`:

```json
{
  "enabled": true,
  "mode": "git",
  "scheduler": "openclaw",
  "default_runtime": "codex",
  "sync_required_for_mutation": true,
  "wip_limits": {
    "ship": 3,
    "dev": 1,
    "research": 1
  },
  "autonomy": {
    "status": true,
    "research": true,
    "draft_rfc": false,
    "start_dev": false,
    "open_pr": true,
    "merge_pr": false
  },
  "budgets": {
    "max_runs_per_day": 12,
    "max_runtime_seconds_per_run": 2400,
    "lease_ttl_minutes": 45,
    "max_attempts_per_stage": 3
  }
}
```

Defaults must be conservative. `start_dev` and `merge_pr` are false by default.

### Lease

`pm/loop/leases/{card-id}.json`:

```json
{
  "card_id": "PM-123",
  "stage": "ship",
  "holder": "openclaw-vm",
  "claimed_at": "2026-06-23T10:00:00Z",
  "expires_at": "2026-06-23T10:45:00Z",
  "run_id": "loop-20260623-100000",
  "base_rev": "abc1234",
  "source": "pm/backlog/example.md"
}
```

A lease is valid only after the lease commit has been pushed. If push fails,
the machine did not claim the card.

### Claim Protocol

Claiming must be atomic from the loop's point of view.

1. Ensure the PM repo has no uncommitted changes under `pm/loop/`.
2. Pull/rebase the PM repo.
3. Rebuild the board from the pulled state.
4. Verify no valid remote lease exists for the selected card.
5. Write exactly one lease file.
6. Commit only that lease file.
7. Push.
8. If push succeeds, dispatch may begin.
9. If push fails:
   - do not dispatch;
   - restore `pm/loop/` to the remote state;
   - pull again;
   - record a local "claim lost" message;
   - stop the run.

The runner must never mix a failed lease commit with later checkpoint commits.

### Run Record

`pm/loop/runs/{run-id}.json`:

```json
{
  "run_id": "loop-20260623-100000",
  "machine_id": "openclaw-vm",
  "mode": "ship-watch",
  "card_id": "PM-123",
  "started_at": "2026-06-23T10:00:00Z",
  "ended_at": "2026-06-23T10:08:00Z",
  "status": "completed",
  "summary": "PR #456 is green and waiting for human merge approval.",
  "artifacts": {
    "pr": "https://github.com/org/repo/pull/456",
    "state_file": ".pm/dev-sessions/example.md"
  }
}
```

### Event Log

Each run gets its own compact event log. Avoid a single shared append file
because concurrent git appends conflict.

```json
{"ts":"2026-06-23T10:00:00Z","run_id":"loop-20260623-100000","event":"claimed","card_id":"PM-123","stage":"ship"}
{"ts":"2026-06-23T10:08:00Z","run_id":"loop-20260623-100000","event":"completed","card_id":"PM-123","summary":"PR #456 waiting for merge approval"}
```

Path:

```text
pm/loop/events/{run-id}.jsonl
```

Do not stream raw command output into git. Keep detailed logs local unless a
summary is needed for audit.

## Board Model

The board is derived, not manually maintained.

Sources:

- `pm/backlog/*.md`
- `pm/backlog/rfcs/*.html`
- `pm/loop/session-snapshots/*.json`
- git branches and PR metadata when available
- `pm/loop/leases/*.json`
- `pm/loop/runs/*.json`

Local `.pm/*` sessions may be shown as local-only rows. They are not eligible for
cross-machine claims until summarized into `pm/loop/session-snapshots/`.

Columns:

| Column | Meaning |
|---|---|
| `inbox` | Captured work lacks routing or required fields |
| `needs-human` | A decision or missing detail blocks progress |
| `needs-research` | Evidence is missing or stale |
| `grooming` | Proposal work is in progress |
| `ready-for-rfc` | Proposal is approved and needs technical design |
| `rfc` | RFC is in progress or awaiting approval |
| `ready-for-dev` | Work can be implemented after approval |
| `implementing` | Branch/worktree/session is active |
| `reviewing` | Simplify, QA, or review gate is active |
| `shipping` | PR, CI, review comments, or merge gate is active |
| `blocked` | Machine cannot proceed without external change |
| `done` | Work is complete |

## Command Surface

Add a new skill and command:

```text
/pm:loop status
/pm:loop wake --dry-run
/pm:loop wake --mode ship-watch
/pm:loop wake --mode bug-poll
/pm:loop config
/pm:loop install openclaw
```

Initial implementation files:

```text
commands/loop.md
skills/loop/SKILL.md
skills/loop/steps/01-status.md
skills/loop/steps/02-wake.md
skills/loop/steps/03-config.md
skills/loop/steps/04-install.md
scripts/loop-board.js
scripts/loop-runner.js
scripts/loop-git.js
scripts/loop-config.js
scripts/loop-ship-watch.js
```

Update:

- `plugin.config.json`
- generated platform manifests
- plugin contract tests
- README command list

## Wake Flow

`pm:loop wake`:

1. Resolve `pm_dir`, `pm_state_dir`, source repo, and machine id.
2. Verify git sync is configured for mutating modes; otherwise stop after status/dry-run.
3. Run `pm:sync pull`.
4. Build the board.
5. Drop expired leases from the in-memory candidate set.
6. Select one eligible card.
7. Claim using the Claim Protocol.
8. If claim fails, stop before dispatch.
9. Dispatch the relevant worker.
10. Write a run record and event summary.
11. Commit and push the checkpoint.
12. Release or renew the lease.

Every wake handles one card by default.

## Selection Rules

Pick work in this order:

1. Existing PRs needing CI/review/comment babysitting.
2. Active dev sessions that can safely resume.
3. Blocked cards whose dependency is now resolved.
4. Approved bugs/tasks ready for dev.
5. Approved RFC/proposal progression.
6. Research refresh.

Do not start new dev if `implementation_approved` is missing.

## Human Checkpoints

Human gates are mandatory at risky transitions.

| Checkpoint | Required by default |
|---|---|
| Product proposal approval | yes |
| RFC approval for M+ work | yes |
| Start implementation | yes |
| Merge PR | yes |
| Missing acceptance criteria | yes |
| Ambiguous bug reproduction | yes |
| Repeated same-stage failure | yes |

Backlog frontmatter may use:

```yaml
implementation_approved: true
approved_by: soelinmyat
approved_at: 2026-06-23
```

Dev eligibility requires both gates:

| Gate | Meaning | Who sets it |
|---|---|---|
| `autonomy.start_dev: true` | Project allows loop-started implementation | human/operator config |
| `implementation_approved: true` | This specific card is approved for implementation | human |

The loop must never create, infer, or modify `implementation_approved`,
`approved_by`, or `approved_at`. It may only read them. Proposal approval and RFC
approval do not imply implementation approval.

The validator must be updated to accept these fields and reject
`implementation_approved: true` without `approved_by` and `approved_at`.

## Worker Contracts

Workers return structured JSON.

```json
{
  "status": "completed",
  "stage": "ship",
  "card_id": "PM-123",
  "summary": "PR #456 is green and waiting for merge approval.",
  "next_stage": "shipping",
  "next_wake_after": null,
  "human_question": null,
  "artifacts": {
    "branch": "fix/example",
    "pr": "https://github.com/org/repo/pull/456"
  }
}
```

Allowed statuses:

- `completed`
- `blocked`
- `failed`
- `skipped`

Repeated `failed` with the same signature moves the card to `blocked`.

For v1, workers should be scripts with machine-readable output. Skills may call
those scripts, but `pm:loop` should not parse conversational skill transcripts.

Initial worker scripts:

```text
scripts/loop-board.js
scripts/loop-runner.js
scripts/loop-git.js
scripts/loop-config.js
scripts/loop-ship-watch.js
```

`loop-ship-watch.js` is intentionally narrower than `pm:ship`: it inspects PR
state, records blockers, and may fix only explicitly supported ship-watch cases.
It must not merge unless `merge_pr=true`.

## Git Checkpoints

Git sync is mandatory at important points.

| Moment | Action |
|---|---|
| Before board scan | pull |
| Before claim | pull |
| Claim lease | commit + push |
| Stage transition | commit + push |
| PR opened | commit + push |
| Blocked question | commit + push |
| Done/failed/skipped | commit + push |
| Lease release | commit + push |

Long runs may renew the lease every 10-15 minutes. Do not push every heartbeat.

Checkpoint pushes must be idempotent. If a checkpoint push fails after worker
success, the runner must pull, verify the remote lease still belongs to the same
run, rewrite the run record deterministically, and retry. It must not append
duplicate events.

## Scheduler Adapters

### OpenClaw v1

`/pm:loop install openclaw` should generate job definitions:

- `pm-loop-status-daily`
- `pm-loop-ship-watch`
- `pm-loop-bug-poll`

Each job calls the same PM command surface. OpenClaw owns schedule, session,
delivery, and run timeout. PM owns selection and state.

### Local Fallback

Later adapters can generate:

- launchd plist
- system cron entry
- GitHub Actions workflow

These must call the same `pm:loop wake` contract.

## Issue Breakdown

### Issue 1: Loop Skill Shell

Add the command, skill, steps, manifest entries, and docs.

Acceptance criteria:

- `/pm:loop status` routes to `skills/loop/SKILL.md`.
- Plugin validation passes.
- README lists the command.
- Skill meets the SKILL.md thickness rules.

Test hooks:

- Plugin contract tests.
- Generated platform manifest tests.
- Skill docs regression tests.

### Issue 2: Board Builder

Add `scripts/loop-board.js`.

Acceptance criteria:

- Emits JSON board from sample backlog/session fixtures.
- Includes column, source path, card id, priority, stage, owner, and blockers.
- Shows active leases and expired leases.
- Does not mutate files.

Test hooks:

- Unit tests with fixture PM directories.
- Parity checks against `scripts/start-status.js` where sections overlap.

### Issue 3: Git-Backed Lease Runtime

Add `scripts/loop-git.js` and lease helpers.

Acceptance criteria:

- Can claim a card by writing a lease and committing.
- Can detect push failure and stop.
- Cleans local stale lease state after claim loss.
- Can release a lease.
- Can ignore expired leases for selection.
- Does not remove a valid lease owned by another holder.

Test hooks:

- Temporary git remotes in tests.
- Competing claim simulation.
- Mixed pending commit prevention.
- Expired lease tests.

### Issue 4: Dry-Run Wake

Add `scripts/loop-runner.js --dry-run`.

Acceptance criteria:

- Pulls/builds board without mutation.
- Explains selected card and skipped candidates.
- Honors `start_dev=false` and `merge_pr=false`.
- Stops with a clear "no eligible work" result.

Test hooks:

- Selection priority tests.
- Policy block tests.
- Empty board test.

### Issue 5: Ship-Watch Mode

Implement the first real worker path.

Acceptance criteria:

- Only handles active PR/session shipping work.
- Does not start new implementation.
- Does not merge unless `merge_pr=true`.
- Records PR state, blockers, and next wake.
- Releases lease after checkpoint.
- Emits structured JSON from `scripts/loop-ship-watch.js`.

Test hooks:

- Mock `gh` command outputs.
- Run record fixture tests.
- Policy tests for merge blocked by default.
- Worker JSON contract tests.

### Issue 6: Implementation Approval Gate

Add schema support and selection enforcement for `implementation_approved`.

Acceptance criteria:

- Loop never starts dev without approval.
- Approved bug/task can be selected when policy allows dev.
- Missing approval moves the card to `needs-human` or explains skip.
- Validator accepts approval frontmatter fields.

Test hooks:

- Validator tests.
- Board classification tests.
- Wake selection tests.

### Issue 7: OpenClaw Install Adapter

Generate OpenClaw cron job definitions.

Acceptance criteria:

- Prints installable job JSON or exact OpenClaw CLI commands.
- Does not require OpenClaw for normal PM use.
- Creates conservative default schedules.
- Documents required project path and runtime.

Test hooks:

- Snapshot tests for generated jobs.
- Config validation tests.

## Risks

| Risk | Mitigation |
|---|---|
| Git history gets noisy | Only push checkpoints, not raw logs |
| Two machines claim same work | Lease commit push is the arbiter |
| Long run lease expires incorrectly | Renew lease at coarse intervals |
| Loop starts weak work | Require human approval before dev |
| Users expect Linear-style board | Keep board output clear and local-first |
| PM repo is not git synced | Status works; wake with claims requires sync |

## Rollout

Phase 1:

- Implement status and board only.
- No mutation except optional config creation.

Phase 2:

- Add dry-run wake and selection.
- Still no leases or worker dispatch.

Phase 3:

- Add git-backed leases and run records.
- Claim and release only.

Phase 4:

- Add ship-watch worker.
- No implementation start.

Phase 5:

- Add implementation approval gate and bug/task dev selection.

Phase 6:

- Add OpenClaw install adapter.

## Open Questions

- Should durable loop state live in `pm/loop/` or a dedicated branch later?
- Should `implementation_approved` be a top-level backlog field or a nested `loop` block?
- Should `pm:sync` become a hard requirement for mutating wake commands?
- Should ship-watch use existing `pm:ship` directly or a smaller PR watcher script?
- Should run records be kept forever or compacted after completion?

## Recommendation

Start with Issues 1-4. That gives us a visible board and dry-run loop selection
without handing the agent new autonomy.

Only after dry-run behavior is boring should we add leases and `ship-watch`.
