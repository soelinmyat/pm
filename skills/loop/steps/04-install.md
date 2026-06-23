---
name: Install
order: 4
description: Explain scheduler installation state and the safe manual wake contract
---

## Goal

Prepare the user to wire a scheduler to the same `pm:loop wake` contract without creating hidden state in cron or OpenClaw.

## How

First run config inspection:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/loop-config.js --pm-dir "$(node ${CLAUDE_PLUGIN_ROOT}/scripts/resolve-pm-dir.js "$PWD")"
```

Then explain the current implementation boundary:

- Scheduler adapters are intentionally thin. They should wake PM and let `pm/loop` state decide.
- The implemented safe wake command is dry-run by default:

  ```bash
  node ${CLAUDE_PLUGIN_ROOT}/scripts/loop-runner.js --project-dir "$PWD" --dry-run --mode dev
  ```

- Explicit lease claiming is available for operator testing:

  ```bash
  node ${CLAUDE_PLUGIN_ROOT}/scripts/loop-runner.js --project-dir "$PWD" --mode dev --no-dry-run --claim-only
  ```

- Real worker dispatch is not enabled in this slice. Do not install a cron/OpenClaw job that assumes unattended coding is live.

If the user specifically asks for OpenClaw, give the intended job names from the RFC (`pm-loop-status-daily`, `pm-loop-ship-watch`, `pm-loop-bug-poll`) and say they should call the same runner contract once the worker slice lands.

## Done-when

The user understands what can be scheduled today (`status` and dry-run/claim-only wake) and what must wait for the worker slice (ship-watch and real implementation dispatch).

**Advance:** stop. The loop skill is complete for this invocation.
