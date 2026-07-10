---
name: loop
description: "Use when the user asks for loop engineering, AI development loop orchestration, a Kanban/Kannan board, periodic wake-ups, git-backed work status sync, scheduler setup, unattended workers, or `/pm:loop status`, `/pm:loop wake`, `/pm:loop config`, `/pm:loop install`, `/pm:loop work`."
---

# pm:loop

## Purpose

Coordinate PM's git-backed loop layer. **Bare `/pm:loop` is a single-command front door**: it reads the current situation (configured? scheduled? paused? cards ready? a wake in progress?) and offers only the next action that fits — so the operator drives the whole loop by running `/pm:loop` and answering. Under the hood it still shows the durable board, plans one wake cycle, inspects conservative autonomy config, sets up the scheduler, and — behind two explicit gates — executes one unit of work unattended via the loop worker. The `status`/`wake`/`config`/`install`/`work` subcommands remain for direct use.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution and runtime conventions.

## When NOT to use

- The user wants to implement a specific item right now in the current session — use `/pm:dev`.
- The user wants to sync the knowledge base manually — use `/pm:sync`.
- The user wants a one-time active-work list without orchestration policy — use `/pm:list`.
- The user wants to create or groom new work — use `/pm:task`, `/pm:bug`, `/pm:groom`, or `/pm:rfc`.

**Workflow:** `loop`

## Steps

Read all `.md` files from `${CLAUDE_PLUGIN_ROOT}/skills/loop/steps/` in numeric filename order. If `.pm/workflows/loop/` exists, same-named files there override defaults. Execute the single step that matches the selected subcommand. **If no subcommand is present, run the router (step 01-route)** — it assesses the situation and routes to the one action that fits, so the operator never needs to remember which subcommand to use.

## Status Definitions

Loop columns are derived from git-synced state under `pm/`:

| Column | Meaning |
|---|---|
| `ready_for_dev` | A card is approved for implementation and has no active lease |
| `implementing` | A card has an active dev lease or synced implementation snapshot |
| `reviewing` | QA or review state is active (legacy `simplify` statuses map here too) |
| `shipping` | PR, CI, review comment, or merge-watch work is active |
| `needs_human` | Missing approval, unclear acceptance criteria, or an operator decision blocks work |
| `needs_rfc` | Proposal needs technical design before implementation |
| `done` | Work is complete |

The canonical card status `needs-human` always maps to `needs_human` and is explicitly non-dispatchable. Only a human decision or an intentional card edit can make it eligible again.

Local `.pm/*` sessions may be displayed as local-only context, but they are not cross-machine claim candidates until summarized into `pm/loop/session-snapshots/`.

Epics use the existing card relations — no loop-specific fields: a card with open `children` is an umbrella and is never dispatched; a child with `parent` set is dispatched only when every earlier sibling in the parent's ordered `children` list is done. Each child still needs its own `implementation_approved` fields (the RFC approval step can write them for the whole epic in one question).

`autonomy.merge_pr` decides the worker's terminal state: `false` (default) stops at an open PR for human review; `true` ships each child through the merge loop when all gates and CI are green and marks the card done, so an approved epic runs child-by-child to completion without human stops. The kill switch and daily budget still apply to every wake.

## Hard rules

- Never start real implementation unless both gates are true — `autonomy.start_dev: true` in `pm/loop/config.json` AND `implementation_approved: true` on the specific backlog card. Verbal approval in chat is not durable cross-machine state.
- Durable eligibility comes from git-synced `pm/`; local `.pm/*` is runtime state only, never a cross-machine claim candidate. A card is owned only after a lease commit is pushed — a failed claim means no ownership and no dispatch.
- Loop workers must be script-like and machine-readable — never parse workflow transcript output. Each child writes only its bounded stage envelope through `PM_LOOP_RESULT_FILE`; the worker verifies it and is the sole canonical card-state writer.
- v1 is git-self-sufficient: don't introduce Linear into the loop path. Schedulers only wake the loop; PM owns board state, leases, and checkpoints. The kill switch and daily budget apply to every wake.
- Report every wake as dry-run, claimed, blocked, or idle, and keep durable `pm/` state distinct from local `.pm/` state in the summary.

## Escalation Paths

- **Implementation gate missing:** "This card is not approved for loop-started implementation. Add `implementation_approved: true`, `approved_by`, and `approved_at` after human approval."
- **Autonomy disabled:** "Project-level loop implementation is disabled. Set `autonomy.start_dev: true` in `pm/loop/config.json` only if unattended pickup is acceptable."
- **No git remote/upstream:** "Mutating loop wakes require git sync. Configure `/pm:sync` first or use dry-run status only."
- **User wants a direct build:** "Use `/pm:dev <id>` for immediate hands-on implementation."
