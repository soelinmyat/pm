---
name: Wake
order: 2
description: Plan one loop wake cycle and optionally claim one lease without dispatching a worker
---

## Goal

Run one loop wake decision so the user can see which card would be selected, skipped, blocked, or claimed.

## How

Default to dry-run unless the user explicitly asks for `--claim-only`.

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/loop-runner.js --project-dir "$PWD" --dry-run
```

Map user language to modes:

| User says | Mode |
|---|---|
| `--mode dev`, "bug poll", "implementation pickup" | `--mode dev` |
| `--mode ship`, "ship watch", "PR babysitter" | `--mode ship` |
| `--mode research`, "research refresh" | `--mode research` |
| no mode | default |

For explicit claim-only, run:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/loop-runner.js --project-dir "$PWD" --mode <mode> --no-dry-run --claim-only
```

Claim-only writes and commits a lease when git sync requirements pass; it never executes work. Execution belongs to the worker (`/pm:loop work`, `scripts/loop-worker.js`), which claims and dispatches in one cycle. If the JSON result says `blocked`, report the `reason` directly and do not retry blindly.

When summarizing JSON:

- `planned` + `dry_run: true` means no mutation happened.
- `idle` means no eligible card matched the mode and policy.
- `blocked` means a policy or sync precondition stopped the wake.
- `claimed` means the machine owns the lease and a future worker could run.

Summarize the wake result with the selected card, skipped candidates, mode, dry-run/mutation status, and the next safe action. If implementation was skipped because `autonomy.start_dev` is false or `implementation_approved` is missing, say that explicitly.
