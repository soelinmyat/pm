---
name: setup
description: "Toggle integrations on or off for this project. Triggers on 'setup enable/disable <integration>', 'enable linear', 'disable ahrefs', 'configure integrations'."
---

# Setup Skill

Toggle integrations on or off for this project.

## Usage

```
/pm:setup enable linear
/pm:setup disable linear
/pm:setup enable ahrefs
/pm:setup disable ahrefs
```

## Supported Integrations

| Integration | Config path | Enable value | Disable value |
|---|---|---|---|
| `linear` | `integrations.linear.enabled` | `true` | `false` |
| `ahrefs` | `integrations.seo.provider` | `"ahrefs"` | `"none"` |

## Config Schema v2 Fields

Schema v2 (`config_schema: 2`) adds two optional repo pointer fields for separate-repo mode. These fields are not present in same-repo mode configs.

| Field | Type | Description |
|---|---|---|
| `pm_repo` | `{ type: "local", path: "<relative-path>" }` | Points from a **source repo** to the PM repo. Path is relative to the config file location (`.pm/config.json`). |
| `source_repo` | `{ type: "local", path: "<relative-path>" }` | Points from a **PM repo** to the source repo. Path is relative to the config file location. |

Example — source repo config (`.pm/config.json` in the app repo):

```json
{
  "config_schema": 2,
  "project_name": "My App",
  "pm_repo": { "type": "local", "path": "../../my-app-pm" },
  "integrations": { "linear": { "enabled": false }, "seo": { "provider": "none" } },
  "preferences": { "auto_launch": true }
}
```

Example — PM repo config (`.pm/config.json` in the PM repo):

```json
{
  "config_schema": 2,
  "project_name": "My App",
  "source_repo": { "type": "local", "path": "../../my-app" },
  "integrations": { "linear": { "enabled": false }, "seo": { "provider": "none" } },
  "preferences": { "auto_launch": true }
}
```

Rules:
- A config with `config_schema: 1` or missing `pm_repo`/`source_repo` fields is same-repo mode — no behavioral change.
- Paths are always stored relative to the directory containing `.pm/config.json`, never as absolute paths.
- `type` is always `"local"` for now. The field exists to support future remote backends.
- A config should have either `pm_repo` or `source_repo`, not both.

## Behavior

1. **Parse the argument.** Extract the action (`enable` or `disable`) and the integration name from the user's message. If either is missing or unrecognized, show usage examples and stop.

2. **Check config exists.** Read `.pm/config.json` from the project root. If it does not exist, tell the user: "No config found. Run `/pm:start` first to initialize the project." and stop.

3. **Update the config.** Read the full JSON, update only the relevant field (see table above), and write the file back. Preserve all other fields.

4. **Linear enable extras.** When enabling Linear (`enable linear`), after setting `integrations.linear.enabled` to `true`, check if `integrations.linear.team` and `integrations.linear.project` are already set. If not, ask the user for their Linear team slug and project name, then write those to the config.

5. **Confirm the change.** Print a short confirmation:
   - "Linear enabled. Refresh the dashboard to see the update."
   - "Linear disabled. Refresh the dashboard to see the update."
   - "Ahrefs SEO enabled. Refresh the dashboard to see the update."
   - "Ahrefs SEO disabled. Refresh the dashboard to see the update."

## Constraints

- This skill only toggles integrations. It does not initialize the project — that is `/pm:start`.
- Do not delete existing config fields when writing back. Only update the specific field.
- If the user runs `/pm:setup` without arguments, show the usage examples above.
