---
name: setup
description: "Toggle integrations on or off for this project, or configure separate-repo mode. Triggers on 'setup enable/disable <integration>', 'enable linear', 'disable ahrefs', 'configure integrations', 'setup separate-repo', 'link repos', 'separate repo'."
---

# Setup Skill

Toggle integrations on or off for this project, or configure separate-repo mode.

## Workflow Loading

Load the setup workflow steps using the step loader:

```
const { loadWorkflow, buildPrompt } = require('${CLAUDE_PLUGIN_ROOT}/scripts/step-loader');
const steps = loadWorkflow('setup', pmDir, '${CLAUDE_PLUGIN_ROOT}');
const workflowPrompt = buildPrompt(steps);
```

The step loader reads step files from `${CLAUDE_PLUGIN_ROOT}/skills/setup/steps/` (defaults) with user overrides from `.pm/workflows/setup/` (if any). Steps are sorted by order and concatenated into the workflow prompt.

Execute the loaded workflow steps in order. Each step contains its own instructions.

## Path Resolution

If `pm_dir` is not in conversation context, check if `pm/` exists at cwd. If yes, use it (same-repo mode). If no, tell the user: 'Run pm:start first to configure paths.' Do not proceed without a valid path.

## Telemetry (opt-in)

If analytics are enabled, read `${CLAUDE_PLUGIN_ROOT}/references/telemetry.md`.
