# Agent Runtime

The workflow contract is provider-neutral. Provider details live in `scripts/dev-runtime/` and `model-profiles.json`.

## Selection

- Use inline execution for one ordered unit when the current agent has the required tools and context.
- Use native subagents for bounded dependency-ready implementation units and required read-only review waves.
- Use the CLI adapter when isolation, an explicit model profile, structured streaming, or resumable worker state materially helps.
- Do not delegate merely to obtain a “fresh” context. Reuse a recorded worker session only for the same unit, ownership, and authority.

## Capability Flags

**Scoped exception — short-lived read-only review waves.** The `pm:review` 6-lens fan-out and groom's scope/team review waves use parallel dispatch by default when native subagents are available. Keep delegation default-off for anything that mutates files or owns a lifecycle. Inline-sequential remains the fallback only when `spawn_agent` is genuinely unavailable or the user deliberately opts out.

### Codex inline execution

Implementation may run inline, but read-only review waves do NOT run inline by default; use parallel `spawn_agent` calls. Inline-sequential is the fallback only when `spawn_agent` is genuinely unavailable or the user has made a deliberate opt-out by explicitly setting `delegation: false`.

### Codex delegated execution

Read-only review waves default here regardless of the session's global `delegation` flag when it is unset. Dispatch the complete wave before waiting so reviewers run concurrently. Mutating units still require the DAG and authority checks described by the implementation step.

## Required capabilities

Before a CLI launch, call `probeCapabilities` and require:

- structured schema output;
- JSON/stream event output;
- safe permission controls;
- resume support when a resume ID is supplied.

Missing support blocks dispatch. Do not silently remove a flag or broaden permissions.

## Profiles

Defaults are data-driven:

| Profile | Provider | Model | Effort | Permission boundary |
|---|---|---|---|---|
| `codex-workhorse` | Codex | `gpt-5.6-sol` | `high` | `workspace-write`, approvals never |
| `claude-workhorse` | Claude | `claude-opus-4-8` | `xhigh` | `auto` |
| `claude-frontier` | Claude | `claude-fable-5` | `xhigh` | `auto` |

Environment overrides are supported by the adapter. Broad modes (`danger-full-access`, `bypassPermissions`) require `PM_DEV_ALLOW_BROAD_PERMISSIONS=1` and are never the default.

Override precedence is provider-specific variable, then generic variable, then profile default:

| Setting | Generic | Codex | Claude |
|---|---|---|---|
| Model | `PM_DEV_MODEL` | `PM_DEV_CODEX_MODEL` | `PM_DEV_CLAUDE_MODEL` |
| Effort | `PM_DEV_EFFORT` | `PM_DEV_CODEX_REASONING_EFFORT` | `PM_DEV_CLAUDE_EFFORT` |
| Permission | — | `PM_DEV_CODEX_SANDBOX` | `PM_DEV_CLAUDE_PERMISSION_MODE` |

## Structured dispatch

Invoke `scripts/dev-runtime/dispatch.js` with runtime, worktree, prompt file, result file, log file, work-unit ID, and the unit's ownership array as `--owns-json`. The adapter:

- prepends root-owned authority constraints;
- writes runtime metadata atomically;
- records JSONL events and stderr separately;
- validates the final worker result, reported HEAD commit, changed-file count, and owned paths;
- persists the runtime session/thread ID for safe resumption;
- classifies missing CLI, malformed output, crash, and quota conditions without claiming success.

`scripts/dispatch-issue.sh` is the legacy-compatible shell entry point. New code should use the Node adapter directly.

## Authority

Workers may inspect, edit, test, and—when granted—commit inside their assigned worktree. The root alone integrates work, pushes, creates or updates PRs, merges, updates trackers, and records aggregate gates. Reject any worker result that claims `merged` or expands its assigned paths/actions.
