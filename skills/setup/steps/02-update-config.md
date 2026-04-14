---
name: Update Config
order: 2
description: Read config.json, update the relevant integration field, handle Linear enable extras
---

## Update Config

**Goal:** Apply exactly one supported config change without disturbing unrelated config state.

### Check config exists

Read `.pm/config.json` from the project root. If it does not exist, tell the user: "No config found. Run `/pm:start` first to initialize the project." and stop.

### Update the config

Read the full JSON, update only the relevant field (see integration table in Step 1), and write the file back. Preserve all other fields. Do not delete existing config fields when writing back.

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

When enabling Linear (`enable linear`), after setting `integrations.linear.enabled` to `true`, check if `integrations.linear.team` and `integrations.linear.project` are already set. If not, ask the user for their Linear team slug and project name, then write those to the config.

**Done-when:** `.pm/config.json` has been read successfully, the requested change has been written without dropping unrelated fields, and any required Linear metadata has been collected or confirmed.

**Advance:** proceed to Step 3 (Confirm).
