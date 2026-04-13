---
name: Parse Args
order: 1
description: Parse the subcommand (enable/disable/separate-repo) and arguments from the user's message
---

## Parse Subcommand and Arguments

**Goal:** Resolve the requested setup action and validate whether this invocation should continue, delegate to separate-repo handling, or stop with usage guidance.

Extract the subcommand from the user's message.

### Supported subcommands

| Subcommand | Arguments | Example |
|---|---|---|
| `enable` | `<integration>` | `/pm:setup enable linear` |
| `disable` | `<integration>` | `/pm:setup disable ahrefs` |
| `separate-repo` | `[path]` (optional) | `/pm:setup separate-repo ../my-pm` |

### Routing

- If the subcommand is `separate-repo`, read and follow `${CLAUDE_PLUGIN_ROOT}/skills/setup/references/separate-repo.md`. After completing that flow, skip to Step 3 (Confirm) with the separate-repo confirmation message.
- If the subcommand is `enable` or `disable`, extract the integration name and continue to Step 2.
- If the subcommand is missing or unrecognized, show usage examples and stop:

```
/pm:setup enable linear
/pm:setup disable linear
/pm:setup enable ahrefs
/pm:setup disable ahrefs
/pm:setup separate-repo [path-to-other-repo]
```

### Supported Integrations

| Integration | Config path | Enable value | Disable value |
|---|---|---|---|
| `linear` | `integrations.linear.enabled` | `true` | `false` |
| `ahrefs` | `integrations.seo.provider` | `"ahrefs"` | `"none"` |

If the integration name is not recognized, show the supported integrations table and stop.

**Done-when:** A valid subcommand has been identified, and either a supported integration is ready for Step 2, separate-repo handling has been delegated, or the skill has stopped after showing usage/help.
