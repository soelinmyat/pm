# Skill Runtime

Shared runtime contract for all PM skills. Each skill references the sections it needs — not all skills use all sections.

---

## Path Resolution

If `pm_dir` is not in conversation context, check if `pm/` exists at cwd. If yes, use it (same-repo mode). If no, tell the user: 'Run pm:start first to configure paths.' Do not proceed without a valid path.

If `pm_state_dir` is not in conversation context, use `.pm` at the same location as `pm_dir`'s parent (i.e., if `pm_dir` = `{base}/pm`, then `pm_state_dir` = `{base}/.pm`). This ensures preference reads and session writes always resolve to the PM repo's `.pm/` directory.

---

## Workflow Loading

Load the workflow steps using the step loader:

```
const { loadWorkflow, buildPrompt } = require('${CLAUDE_PLUGIN_ROOT}/scripts/step-loader');
const steps = loadWorkflow('{SKILL_NAME}', pmDir, '${CLAUDE_PLUGIN_ROOT}');
const workflowPrompt = buildPrompt(steps);
```

The step loader reads step files from `${CLAUDE_PLUGIN_ROOT}/skills/{SKILL_NAME}/steps/` (defaults) with user overrides from `.pm/workflows/{SKILL_NAME}/` (if any). Steps are sorted by order and concatenated into the workflow prompt. Persona references (`@persona`) in step files are resolved from `${CLAUDE_PLUGIN_ROOT}/personas/`.

Execute the loaded workflow steps in order. Each step contains its own instructions.

---

## Telemetry (opt-in)

If analytics are enabled, read `${CLAUDE_PLUGIN_ROOT}/references/telemetry.md` for the full contract.

Each skill defines its own step names for telemetry spans. The shared contract covers: enabling analytics, run-level events (start/end), step-level spans, and output file tracking.

---

## Custom Instructions

Before starting work, check for user instructions:

1. If `{pm_dir}/instructions.md` exists, read it — these are shared team instructions (terminology, writing style, output format, competitors to track).
2. If `{pm_dir}/instructions.local.md` exists, read it — these are personal overrides that take precedence over shared instructions on conflict.
3. If neither file exists, proceed normally.

**Override hierarchy:** `{pm_dir}/strategy.md` wins for strategic decisions (ICP, priorities, non-goals). Instructions win for format preferences (terminology, writing style, output structure). Instructions never override skill hard gates.

---

## Interaction Pacing

Ask ONE question at a time. Wait for the user's answer before asking the next. Do not bundle multiple questions in a single message. When you have follow-ups, ask the most important one first — the answer often makes the others unnecessary.
