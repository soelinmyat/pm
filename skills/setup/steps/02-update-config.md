---
name: Update Config
order: 2
description: Read config.json, update the relevant integration field, handle Linear enable extras
---

## Update Config

## Goal

Apply exactly one supported config change without disturbing unrelated config state.

## How

Validate the owning config first, then run the receipt-backed config effect for only the selected field. Do not write the config directly.

### Check config exists

Run `resolve-pm-dir.js --json` and use its `configPath` and `sourceDir`. If resolution fails, surface the error and stop. If `configPath` is null, tell the user: "No config found. Run `/pm:start` first to initialize the project." and stop. Do not substitute a cwd config check.

### Update the config

Map the action through the integration table in Step 1, encode its value as JSON, and run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/config-effect.js" \
  --project-dir "{config_owner_dir}" \
  --field "{config.path}" \
  --value-json '{json-value}' \
  --authorize update_config
```

For `.pm/config.json`, set `{config_owner_dir}` to the directory that contains `.pm/`. The current config-effect adapter does not mutate tracked `pm.config.json`; if the resolver returns that form, stop and explain that setup must migrate it before updating integrations. The explicit `/pm:setup enable|disable {integration}` request grants only `update_config` for the named field. The script plans against the current config hash, atomically preserves unrelated fields, re-reads the target, and stores a private journal under the owning `.pm/effects/`.

Read its JSON result:

- `state: verified` — continue. `replayed: true` means the intended value was already verified and no write was repeated.
- `state: blocked` — stop and show `recovery.code`, its reason, and `recovery.command`.
- `state: ambiguous` — do not retry. Show the journal path and exact recovery action so the target can be inspected first.

Never treat process exit alone as success and never repair the file with an ad hoc second write.

### Config Schema v2 Fields

Schema v2 (`config_schema: 2`) adds two optional repo pointer fields for separate-repo mode. These fields are not present in same-repo mode configs.

| Field | Type | Description |
|---|---|---|
| `pm_repo` | `{ type: "local", path: "<relative-path>" }` | Points from a **source repo** to the PM repo. Path is relative to the config file location (`.pm/config.json`). |
| `source_repo` | `{ type: "local", path: "<relative-path>" }` | Points from a **PM repo** to the source repo. Path is relative to the config file location. |

Rules:
- A config with `config_schema: 1` or missing `pm_repo`/`source_repo` fields is same-repo mode — no behavioral change.
- Paths are always stored relative to the directory containing `.pm/config.json`, never as absolute paths.
- `type` is always `"local"` for now. The field exists to support future remote backends.
- A config should have either `pm_repo` or `source_repo`, not both.

### Linear enable extras

When enabling Linear (`enable linear`), after the enabled effect verifies, check if `integrations.linear.team` and `integrations.linear.project` are already set. If not, ask the user for their Linear team slug and project name. Apply each confirmed field through the same command and authority action; each receives its own exact intent and receipt.

## Done-when

Every requested field has a `verified` effect result, unrelated fields are preserved, the saved JSON parses successfully, and any non-verified result has stopped with its journal-backed recovery action.

**Advance:** proceed to Step 3 (Confirm).
