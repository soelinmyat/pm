---
name: Config
order: 3
description: Inspect or initialize conservative loop configuration
---

## Goal

Show the current loop config, or initialize the default conservative config when the user asks for setup.

## How

For read-only config inspection:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/loop-config.js --pm-dir "$(node ${CLAUDE_PLUGIN_ROOT}/scripts/resolve-pm-dir.js "$PWD")"
```

For explicit initialization:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/loop-config.js --pm-dir "$(node ${CLAUDE_PLUGIN_ROOT}/scripts/resolve-pm-dir.js "$PWD")" --init
```

Highlight these fields when explaining the output:

- `sync_required_for_mutation` must remain true for cross-machine safety.
- `autonomy.start_dev` defaults false and gates implementation pickup.
- `autonomy.merge_pr` defaults false and gates auto-merge.
- `budgets.lease_ttl_minutes` controls lease expiry.

Do not modify `implementation_approved`, `approved_by`, or `approved_at` on backlog cards from this step.
