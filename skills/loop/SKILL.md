---
name: loop
description: "Use when the user asks for loop engineering, AI development loop orchestration, a Kanban/Kannan board, periodic wake-ups, git-backed work status sync, scheduler setup, OpenClaw loop jobs, or `/pm:loop status`, `/pm:loop wake`, `/pm:loop config`, `/pm:loop install`."
---

# pm:loop

## Purpose

Coordinate PM's git-backed loop layer. `/pm:loop` shows the durable board, plans one wake cycle, inspects conservative autonomy config, and prepares scheduler setup while existing PM skills still own the actual work.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution, telemetry, and custom instructions.

Read `${CLAUDE_PLUGIN_ROOT}/references/writing.md` before generating any output.

## Iron Law

**NEVER START REAL IMPLEMENTATION UNLESS BOTH GATES ARE TRUE.** `autonomy.start_dev: true` in `pm/loop/config.json` and `implementation_approved: true` on the specific backlog card are both required before loop may pick up implementation work.

## When NOT to use

- The user wants to implement a specific item right now in the current session — use `/pm:dev`.
- The user wants to sync the knowledge base manually — use `/pm:sync`.
- The user wants a one-time active-work list without orchestration policy — use `/pm:list`.
- The user wants to create or groom new work — use `/pm:task`, `/pm:bug`, `/pm:groom`, or `/pm:rfc`.

**Workflow:** `loop` | **Telemetry steps:** `status`, `wake`, `config`, `install`.

## Steps

Read all `.md` files from `${CLAUDE_PLUGIN_ROOT}/skills/loop/steps/` in numeric filename order. If `.pm/workflows/loop/` exists, same-named files there override defaults. Execute the single step that matches the selected subcommand; if no subcommand is present, run `status`.

## Status Definitions

Loop columns are derived from git-synced state under `pm/`:

| Column | Meaning |
|---|---|
| `ready_for_dev` | A card is approved for implementation and has no active lease |
| `implementing` | A card has an active dev lease or synced implementation snapshot |
| `reviewing` | Simplify, QA, or review state is active |
| `shipping` | PR, CI, review comment, or merge-watch work is active |
| `needs_human` | Missing approval, unclear acceptance criteria, or an operator decision blocks work |
| `needs_rfc` | Proposal needs technical design before implementation |
| `done` | Work is complete |

Local `.pm/*` sessions may be displayed as local-only context, but they are not cross-machine claim candidates until summarized into `pm/loop/session-snapshots/`.

## Red Flags — Self-Check

- **"The card looks ready, so I can start dev."** No. Check both gates: project autonomy and per-card implementation approval.
- **"I can use `.pm/dev-sessions` to decide cross-machine work."** No. `.pm` is local runtime state; durable eligibility comes from `pm/`.
- **"Dry-run selected a card, so the machine owns it."** No. A card is owned only after a lease commit is pushed.
- **"The loop can parse `/pm:dev` transcript output."** No. Loop workers must be script-like and machine-readable.
- **"A push failure is probably fine; continue anyway."** No. Failed claim means no ownership, no dispatch.

## Escalation Paths

- **Implementation gate missing:** "This card is not approved for loop-started implementation. Add `implementation_approved: true`, `approved_by`, and `approved_at` after human approval."
- **Autonomy disabled:** "Project-level loop implementation is disabled. Set `autonomy.start_dev: true` in `pm/loop/config.json` only if unattended pickup is acceptable."
- **No git remote/upstream:** "Mutating loop wakes require git sync. Configure `/pm:sync` first or use dry-run status only."
- **User wants a direct build:** "Use `/pm:dev <id>` for immediate hands-on implementation."

## Common Rationalizations

| Excuse | Reality |
|---|---|
| "The user said 'sounds good,' so implementation is approved." | Verbal approval in chat is not durable cross-machine state. The backlog card needs explicit approval fields. |
| "Linear can track this later." | v1 is intentionally self-sufficient with git. Do not introduce Linear into the loop path. |
| "A single JSONL event log is simpler." | Per-run event logs avoid append conflicts across machines. |
| "Cron/OpenClaw can own state." | Schedulers wake the loop; PM owns board state, leases, and checkpoints. |

## Before Marking Done

- [ ] The selected subcommand ran through its matching step.
- [ ] The response distinguishes durable `pm/` state from local `.pm/` state.
- [ ] Any wake result reports whether it was dry-run, claimed, blocked, or idle.
- [ ] Real implementation was not started unless both gates were true.
- [ ] The user-facing summary includes the next concrete command or file to inspect.
