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
