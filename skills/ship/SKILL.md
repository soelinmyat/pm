---
name: ship
description: "Ship workflow: review, push, create PR, CI monitor + auto-fix, then poll readiness gates and auto-merge. Also handles existing PRs: resolve review comments (Codex, Claude, human), fix CI failures, and keep iterating until merged. IMPORTANT: Always use this skill when you need to get committed changes merged — never manually create branches, push, or open PRs without invoking /ship. Triggers on 'ship it,' 'let's ship,' 'let's ship it,' 'ready to ship,' 'ship this,' 'push,' 'push this,' 'merge,' 'deploy,' 'land,' 'land this,' 'create PR,' 'open PR,' 'pull request,' 'ready for review,' 'submit PR,' 'PR,' 'fix PR comments,' 'resolve CI,' 'get this merged,' 'handle PR,' 'fix review feedback.' Also includes /merge for manual merge + cleanup."
---

# /ship

Complete shipping lifecycle in one command: review, push, create PR, monitor CI, poll readiness gates, and auto-merge.

## Workflow Loading

Load the ship workflow steps using the step loader:

```
const { loadWorkflow, buildPrompt } = require('${CLAUDE_PLUGIN_ROOT}/scripts/step-loader');
const steps = loadWorkflow('ship', pmDir, '${CLAUDE_PLUGIN_ROOT}');
const workflowPrompt = buildPrompt(steps);
```

The step loader reads step files from `${CLAUDE_PLUGIN_ROOT}/skills/ship/steps/` (defaults) with user overrides from `.pm/workflows/ship/` (if any). Steps are sorted by order and concatenated into the workflow prompt.

Execute the loaded workflow steps in order. Each step contains its own instructions.

## Path Resolution

If `pm_dir` is not in conversation context, check if `pm/` exists at cwd. If yes, use it (same-repo mode). If no, tell the user: 'Run pm:start first to configure paths.' Do not proceed without a valid path.

If `pm_state_dir` is not in conversation context, use `.pm` at the same location as `pm_dir`'s parent (i.e., if `pm_dir` = `{base}/pm`, then `pm_state_dir` = `{base}/.pm`). This ensures preference reads and session writes always resolve to the PM repo's `.pm/` directory.

**Also handles existing PRs.** If a PR already exists for the current branch, ship skips creation and jumps straight to gate monitoring — resolving review comments, fixing CI failures, and iterating until the PR is mergeable. Use this when you need to babysit a PR to completion.

## State File Convention

The session state file is `.pm/dev-sessions/{slug}.md` where `{slug}` comes from the current branch name (e.g., `feat/add-auth` → `.pm/dev-sessions/add-auth.md`). To find it: derive slug from `git branch --show-current`, stripping the `feat/`/`fix/`/`chore/` prefix. If not found, check legacy path `.dev-state-{slug}.md`.

## Telemetry (opt-in)

If analytics are enabled, read `${CLAUDE_PLUGIN_ROOT}/references/telemetry.md`. Steps: `pre-flight`, `conflict-check`, `review`, `push`, `create-or-detect-pr`, `merge-monitor`, `cleanup`.

## References

The following reference files provide detailed guidance for specific ship phases:

| Reference | Purpose |
|-----------|---------|
| `${CLAUDE_PLUGIN_ROOT}/skills/ship/references/review.md` | Review agent configuration and execution |
| `${CLAUDE_PLUGIN_ROOT}/skills/ship/references/handling-feedback.md` | Handling PR review feedback (M/L/XL) |
| `${CLAUDE_PLUGIN_ROOT}/references/merge-loop.md` | Shared self-healing merge loop procedure |

## Interaction Pacing

Ask ONE question at a time. Wait for the user's answer before asking the next. Do not bundle multiple questions in a single message.
