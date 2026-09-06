---
title: Execution model policy
created: 2026-09-06
updated: 2026-09-06
---

# Execution model policy

Use a saved policy when the user wants one model choice across PM workflows.
This selects models and effort only. It never grants permissions, external
effects, or approval, and it does not alter the interactive host model.

Without a saved policy, existing workhorse defaults remain unchanged. Inline
work always inherits the current agent. An explicit named profile wins over a
saved policy; persisted sessions retain their recorded profile on resume.

Create a JSON input file with this structure:

```json
{
  "schema_version": 1,
  "defaults": { "codex": { "model": "gpt-6-astra", "effort": "high" } },
  "workflows": {
    "review": { "codex": { "model": "gpt-6-astra", "effort": "xhigh" } }
  }
}
```

These are selectable settings, not a claim that a particular effort is optimal.
Supported workflows are `dev`, `groom`, `rfc`, and `review`; provider selections
are `codex` and `claude`. Models must exist in the installed profile registry.
An unknown model, malformed policy, or unsupported effort fails before dispatch.

Save a project policy or a user policy explicitly:

```bash
node "$PM_PLUGIN_ROOT/scripts/pm-execution-policy.js" set --source-dir /path/to/project --input /path/to/policy.json
node "$PM_PLUGIN_ROOT/scripts/pm-execution-policy.js" set --user --input /path/to/policy.json
node "$PM_PLUGIN_ROOT/scripts/pm-execution-policy.js" show --source-dir /path/to/project
```

Project policy lives in `.pm/execution-policy.json`. User policy lives in
`$XDG_CONFIG_HOME/pm/execution-policy.json`, or `~/.config/pm/execution-policy.json`
when XDG is unset. Project selections override user selections per provider;
within each file a workflow-specific selection overrides its default.
`PM_EXECUTION_POLICY_FILE` selects one exact policy file instead of those two
locations. It is an explicit override: a missing file is an error.

Dev's existing explicit model/effort and environment overrides retain their
precedence. Astra identity still requires the named Astra base profile; a
conflicting model override cannot silently change its identity. The resolved
profile, model, and effort are recorded in existing sessions and review worker
allocations. New policy values apply to new sessions; resume does not silently
reselect a running task's model.

To return new sessions to workhorse defaults, save an empty policy with
`"defaults": {}` and `"workflows": {}` at the relevant scope, or remove the
explicitly selected policy. An empty project policy still permits user defaults.
