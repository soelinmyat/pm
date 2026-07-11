# Dev Session State

## Canonical v2 State

`session.json` is the lifecycle source of truth. Markdown files are compatibility inputs and optional human projections; they never advance a v2 session.

Create and update v2 sessions only through `${PM_PLUGIN_ROOT}/scripts/dev-session.js`:

```text
dev-session init --slug <slug> --source-dir <path> [--task <path-or-id>]
dev-session status --session <path> [--json]
dev-session next --session <path> [--json]
dev-session prompt --session <path> --output <path>
dev-session route --session <path> --facts <json-path> [--json]
dev-session record --session <path> --result <path>
dev-session validate --session <path>
dev-session migrate --legacy <path> [--output <path>]
dev-session project --session <path> [--output <path>]
```

The canonical path is:

```text
{source_dir}/.pm/dev-sessions/{slug}/session.json
```

Prompts, results, logs, and evidence for that run live beside `session.json`. The runner writes JSON artifacts by temporary-file-plus-rename and enforces file mode `0600`.

The machine-readable schema is [`dev-session.schema.json`](./dev-session.schema.json). Runtime validation is dependency-free and lives in `scripts/lib/dev-session-schema.js`.

### Transition ownership

The runner is the only lifecycle writer. `next` and `prompt` are read-only. `record` advances state only after the result envelope passes all checks:

- `run_id`, phase, and attempt exactly match the session.
- A passed phase supplies the evidence kinds and commit required by `next`.
- A supplied commit is reachable from the recorded branch and equals its current head. Older evidence is stale.
- A blocked result contains a stable blocker code and reason.
- The same failed phase receives at most three validated attempts before the session blocks.
- Completion requires every routed phase and final required gate to have current evidence.

Every accepted result appends a history record with the prior phase, next phase, reason, SHA-256 result hash, timestamp, and runner version. Results never grant authority or modify routing.

### Intake routing

Fresh sessions start with a conservative compatibility sequence:

```text
intake -> workspace -> readiness -> implementation -> design-critique -> qa -> review -> ship -> retro
```

During intake, `dev-session route` replaces that sequence with the executable decision from observed kind, size, risk, UI impact, and non-behavioral exceptions. A cold process recovers the current action solely by running `dev-session next --session ... --json`.

### Result envelope

All execution modes return the same schema-version-1 envelope:

```json
{
  "schema_version": 1,
  "run_id": "dev_01J...",
  "phase": "implementation",
  "attempt": 1,
  "status": "passed",
  "summary": "Implemented deterministic transitions.",
  "commit": "abc123",
  "files_changed": ["scripts/dev-session.js"],
  "evidence": [
    {
      "kind": "test",
      "command": "node --test tests/dev-session-state.test.js",
      "exit_code": 0,
      "artifact": null
    }
  ],
  "blocker": null,
  "runtime": {
    "provider": "codex",
    "model": "gpt-5.6-sol",
    "reasoning": "high",
    "session_id": null
  }
}
```

Allowed statuses are `passed`, `failed`, `blocked`, and `noop`. Process exit code alone never proves phase success.

### CLI exit codes

| Code | Meaning |
|---:|---|
| 0 | Command succeeded |
| 2 | Invalid arguments or schema |
| 3 | Precondition or capability missing |
| 4 | Result invalid or evidence incomplete |
| 5 | Session blocked on a user or external decision |
| 6 | Retry budget exhausted |

## Legacy Markdown Compatibility

Legacy Markdown is read only for migration and for tools not yet moved to v2. `dev-session migrate` retains the source file and writes a new canonical `session.json`; it never deletes or overwrites the Markdown input.

## Location

State files live under `.pm/dev-sessions/`, namespaced by feature slug to allow concurrent sessions:

- **All sessions:** `.pm/dev-sessions/{slug}/session.json` — where `{slug}` is derived from the branch name by the shared helper exported from `${CLAUDE_PLUGIN_ROOT}/scripts/dev-gate-check.js` as `deriveSessionSlug`.
- **Gate sidecar:** `.pm/dev-sessions/{slug}/gates.json` — machine-checkable quality gate state consumed by `${CLAUDE_PLUGIN_ROOT}/scripts/dev-gate-check.js`.
- **`.gitignore`:** `.pm/` covers all state files (no separate pattern needed).
- **Directory creation:** If `.pm/dev-sessions/` does not exist, create it (`mkdir -p .pm/dev-sessions`) before the first write.

Slug normalization:

1. Start from `git branch --show-current`.
2. Strip one leading branch-family prefix: `codex/`, `feat/`, `fix/`, `chore/`, or `release/`.
3. Replace any remaining `/` characters with `-`.

Examples: `feat/add-auth` -> `add-auth`; `codex/pm-dev-workflow-proposal` -> `pm-dev-workflow-proposal`; `release/v1.2.3` -> `v1.2.3`; `team/feature/foo` -> `team-feature-foo`. For XS tasks with no branch, use the topic slug from intake.

**Repo location:** Dev sessions always live in the source repo's `.pm/dev-sessions/` directory — even in separate-repo mode. This keeps dev state co-located with the code being modified. In same-repo mode, `source_dir` == cwd, so the path is `.pm/dev-sessions/{slug}/session.json` as before.

## Legacy Migration

On resume detection or any state file read, also check legacy paths (`.dev-state-{slug}.md`, `.dev-epic-state-{slug}.md` at repo root, and `epic-{slug}.md` in `.pm/dev-sessions/`). If found at legacy path but not at new path, read from legacy. New writes always go to `.pm/dev-sessions/{slug}/session.json`.

## Context Recovery

For a v2 session, run `dev-session next --session ... --json`; `session.json` is the source of truth, not conversation history. For a legacy session that has not been migrated, read the Markdown state file first.

After compaction or if context feels stale, read this file to recover full session state.

## Valid Phase Values

`intake`, `workspace`, `readiness`, `implementation`, `design-critique`, `qa`, `review`, `ship`, `retro`. Legacy `rfc-check`, `implement`, and `simplify` migrate to `readiness`, `implementation`, and `review`.

## Valid Task Status Values

These are the only valid values for the `Status` column in the `## Tasks` table:

| Value | Meaning |
|-------|---------|
| `pending` | Task has not started |
| `in-progress` | Agent has been dispatched and is working |
| `implementing` | Agent is in the implementation phase (multi-task lifecycle tracking) |
| `reviewing` | Agent is in the review phase |
| `shipping` | Agent is in the push/PR/merge phase |
| `done` | Task completed successfully (single-task) or merged (multi-task) |
| `failed` | Task failed after max retry attempts |
| `blocked` | Task blocked by an issue requiring user input |
| `skipped` | Task was already implemented or intentionally skipped |

Multi-task per-task agents should update the Tasks table status at each lifecycle transition (via the orchestrator's checkpoint). This enables accurate resume and retro.

## Gate Manifest Sidecar

Every dev session that can push, create a PR, or ship code must maintain `.pm/dev-sessions/{slug}/gates.json` for existing hooks and ship gates. In v2, `session.json` is the lifecycle source of truth and the sidecar is the executable quality-gate contract until those consumers move to v2 evidence. In legacy sessions, Markdown remains the human-readable projection.

Schema:

```json
{
  "schema_version": 1,
  "size": "M",
  "kind": "proposal",
  "gates": [
    {
      "name": "tdd",
      "status": "passed",
      "commit": "abc123",
      "artifact": ".pm/dev-sessions/feature.tdd.json",
      "reason": "",
      "checked_at": "2026-04-04T04:20:00Z",
      "verified_commit": "def456",
      "verified_at": "2026-04-04T05:10:00Z"
    }
  ]
}
```

Gate names are `tdd`, `design-critique`, `qa`, `review`, and `verification` (`simplify` is a tolerated legacy name from pre-v1.9 sidecars — never required, never validated for freshness). Status values are `passed`, `skipped`, `failed`, and `blocked`. Top-level `size` and `kind` mirror the dev session routing context; they are required when a skip reason depends on that routing context.

Rules:

- Update the row immediately after each gate runs or is explicitly skipped.
- `commit` is the evidence commit where the gate ran or was explicitly skipped.
- `verified_commit` / `verified_at` are optional recertification fields written after later commits. They mean the original gate evidence was rechecked against that final tree. These two fields must be written together.
- The `review` row carries a `lenses` array recording which lenses actually ran (e.g. `["bug", "design", "edge", "reuse", "quality", "efficiency"]`, minus `design` when conditionally skipped). On M/L/XL manifests the checker requires the absorbed lenses `reuse`, `quality`, `efficiency` to be present — a pre-v1.9 3-lens review row does not pass.
- Final push/ship checks accept a row only when either `commit` or `verified_commit` equals `git rev-parse HEAD`; otherwise the row is stale.
- `passed` rows need an existing artifact path. State-file section anchors such as `.pm/dev-sessions/{slug}/session.json#review` are valid when the file exists. `skipped`, `failed`, and `blocked` rows need a concrete reason.
- `tdd`, `design-critique`, and `qa` may be skipped only when the workflow has an explicit valid skip reason. `review` and `verification` cannot satisfy push/ship checks as `skipped`; they must be `passed`.
- `design-critique` and `qa` skip reasons must describe no UI/user-visible impact (for example backend-only, docs-only, non-UI config-only, generated-only, pure refactor, or no visual impact). UI config, design-token/theme data, static HTML, and server-rendered templates are UI-impacting. Environment failures, auth failures, missing DBs, or servers that cannot start are `blocked`, not `skipped`.
- Before final verification, run the final recertification pass in `skills/dev/steps/07-review.md`: rerun any gate whose relevant surface changed after its evidence commit, or write `verified_commit` / `verified_at` when the gate evidence still applies to final HEAD.
- Before any PM-mediated push, PR creation, or ship handoff, run:
  ```bash
  PM_PLUGIN_ROOT="${PM_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:?Set PM_PLUGIN_ROOT to the PM plugin root}}"
  node "$PM_PLUGIN_ROOT/scripts/dev-gate-check.js" \
    --manifest .pm/dev-sessions/{slug}/gates.json \
    --commit "$(git rev-parse HEAD)" \
    --base origin/{DEFAULT_BRANCH}
  ```
- If the checker fails for a missing gate, run that gate. If it fails for a stale gate, use the final recertification rule above: rerun the gate when its relevant surface changed, or write `verified_commit` / `verified_at` only when the evidence still applies. Do not push around it.

## Template

```markdown
# Dev Session State

| Field | Value |
|-------|-------|
| Run ID | {PM_RUN_ID} |
| Stage | implement |
| Size | M |
| Task Count | 1 |
| Ticket | PROJ-456 |
| Repo root | /path/to/project |
| Active cwd | /path/to/project/.worktrees/feature-name |
| RFC | {pm_dir}/backlog/rfcs/feature-name.html |
| Branch | feat/feature-name |
| Worktree | .worktrees/feature-name |
| Started at | 2026-04-04T01:00:00Z |
| Stage started at | 2026-04-04T03:20:00Z |
| Completed at | null |

## Project Context
- Product: Example App — task management for teams
- Stack: Rails API + React frontend + React Native mobile
- Test command: pnpm test (inferred from package.json)
- Issue tracker: Linear (detected via MCP)
- Monorepo: yes (apps/api, apps/web-client, apps/mobile)
- CLAUDE.md: present
- AGENTS.md: present
- Strategy: present

## Decisions
- Platform: frontend (frontend + backend files modified)
- Spec review: passed (commit abc123)
- Plan review: passed (commit def456)
- Continuous execution: authorized
- Contract gate: passed (commit ghi789) — frontend detected, gate required
- Design critique: required (frontend files modified)
- E2E: yes (CRUD flow)

## Tasks (always present — sourced from RFC Issue sections)

| Issue # | Title | Size | Status | Branch | PR |
|---------|-------|------|--------|--------|----|
| 1 | First task | S | done | feat/first-task | #312 |
| 2 | Second task | M | in-progress | feat/second-task | — |

Tasks are populated during intake from the RFC's JSON sidecar `issues[]` when it is present and valid (`num`, `title`, `size`), falling back to the HTML `.issue-detail` cards for pre-sidecar RFCs (see `${CLAUDE_PLUGIN_ROOT}/skills/rfc/references/writing-rfcs.md` § JSON Sidecar Contract). Single-task sessions have one row. The RFC is the single source of truth for task decomposition — not Linear sub-issues or backlog `children:` fields. See "Valid Task Status Values" above for allowed Status values.

## Key Files
- backend/app/controllers/api/v1/features_controller.rb
- frontend/src/features/feature-name/FeatureList.tsx

## Design Critique
- Status: pending
- Size routing: S (lite, 1 round) | M/L/XL (full)
- Report: (not yet run)

## QA
- QA verdict: pending
- Ship recommendation: pending
- Issues found: pending
- Issues fixed: none
- Issues deferred: none
- Confidence: pending
- Re-runs: 0

## Review
- Review gate: pending

## Gate Manifest
- Sidecar: .pm/dev-sessions/{slug}/gates.json
- Checker: set `PM_PLUGIN_ROOT="${PM_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:?Set PM_PLUGIN_ROOT to the PM plugin root}}"`, then run `node "$PM_PLUGIN_ROOT/scripts/dev-gate-check.js" --manifest .pm/dev-sessions/{slug}/gates.json --commit "$(git rev-parse HEAD)"`
- Required before push: tdd, design-critique, qa, review, verification (skipped gates require reasons)

## Merge-Watch
- Stage: pending
- PR: (not yet created)
- Gate 1 (CI): pending
- Gate 2 (Claude review): pending
- Gate 3 (Codex review): pending
- Gate 4 (Comments): pending
- Gate 5 (Conflicts): pending

## Merge Loop Retries

Persisted retry counters per gate + problem signature. Survives agent restarts so a recovered agent doesn't reset its retry budget.

| Gate | Signature | Attempts | Last action |
|------|-----------|----------|-------------|
| ci | lint:no-unused-vars in src/auth/session.ts | 2 | removed import, renamed var — still failing |
| ci | test:AuthSpec#login_rejects_expired_token | 1 | updated expiry clock handling |
| review-comment | thread:RT_kwDO...abc (modal-vs-drawer) | 1 | flagged as design-call — pending user |

Rules:
- Signature is `{gate}:{short-id}` — enough to identify the same problem across iterations. For CI, use `{check-type}:{failing-symbol-or-test}`. For review comments, use `thread:{thread-id}`. For conflicts, use `file:{path}`.
- Write one row per unique signature. Update Attempts in-place, don't append duplicates.
- Attempts >= 3 on the same signature triggers escalation (the HARD-RULE on repeat-failure escalation). The escalation reads this table to populate the `tried:` field of the structured Blocked line.
- Clear the table only when the PR reaches state `MERGED`.

## Per-Task Events (multi-task only — written by Step 05 checkpoint)
- Task 1: reviews=0, CI runs=1, conflict commits=0, verdict=Merged
- Task 2: reviews=2, CI runs=3, conflict commits=1, verdict=Merged
- Task 3: verdict=Blocked (reason: missing API endpoint)

Per-task agents handle QA/review/ship internally. This section aggregates key events extracted from each task's PR after the agent returns, so retro (Step 09) can learn from them. See Step 05 checkpoint for extraction logic.

## Linear Context (if sourced from Linear)
| Field | Value |
|-------|-------|
| Linear ID | {ID or null} |
| Linear readiness | dev-ready / needs-groom / null |
| Linear fetch | succeeded / failed / null |
| Linear gaps | [missing-ac, vague-scope, unclear-size] or [] |
| Linear labels | {labels or []} |

## Resume Instructions
- Stage: [current stage name]
- Next action: [single next action to take]
- Key context: [1-2 sentences a cold reader needs]
- Blockers: [any blocking issues, or "none"]
```

## Update Rules

- Write the full file (not append) at each stage transition
- Keep `Stage started at` current at every stage transition and set `Completed at` when the session finishes
- Include all decisions made so far — a cold reader should understand the full context
- After design critique, add the report path
- After every quality gate, update `.pm/dev-sessions/{slug}/gates.json`
- Resume Instructions section must be populated at every stage transition. A cold reader should be able to continue the session from this section alone.
- After retro, delete the file
