---
name: Confirm
order: 3
description: Confirm changes and display status to the user
---

## Confirm the Change

Print a short confirmation based on the action taken:

| Action | Message |
|---|---|
| `enable linear` | "Linear enabled." |
| `disable linear` | "Linear disabled." |
| `enable ahrefs` | "Ahrefs SEO enabled." |
| `disable ahrefs` | "Ahrefs SEO disabled." |
| `separate-repo` | "Config written to both repos. Run `pm:start` to activate separate-repo mode." |

## Constraints

- This skill toggles integrations and configures separate-repo mode. It does not initialize the project — that is `/pm:start`.
- Do not delete existing config fields when writing back. Only update the specific field.
- If the user runs `/pm:setup` without arguments, show the usage examples from Step 1.
