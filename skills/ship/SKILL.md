---
name: ship
description: "Ship workflow: review, push, create PR, CI monitor + auto-fix, then poll readiness gates and auto-merge. Also handles existing PRs: resolve review comments (Codex, Claude, human), fix CI failures, and keep iterating until merged. IMPORTANT: Always use this skill when you need to get committed changes merged — never manually create branches, push, or open PRs without invoking /ship. Triggers on 'ship it,' 'let's ship,' 'let's ship it,' 'ready to ship,' 'ship this,' 'push,' 'push this,' 'merge,' 'deploy,' 'land,' 'land this,' 'create PR,' 'open PR,' 'pull request,' 'ready for review,' 'submit PR,' 'PR,' 'fix PR comments,' 'resolve CI,' 'get this merged,' 'handle PR,' 'fix review feedback.' Also includes /merge for manual merge + cleanup."
---

# /ship

Complete shipping lifecycle in one command: review, push, create PR, monitor CI, poll readiness gates, and auto-merge.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution, workflow loading, telemetry, and interaction pacing.

**Workflow:** `ship` | **Telemetry steps:** `pre-flight`, `conflict-check`, `review`, `push`, `create-or-detect-pr`, `merge-monitor`, `cleanup`.

Execute the loaded workflow steps in order. Each step contains its own instructions.

**Also handles existing PRs.** If a PR already exists for the current branch, ship skips creation and jumps straight to gate monitoring — resolving review comments, fixing CI failures, and iterating until the PR is mergeable. Use this when you need to babysit a PR to completion.

## State File Convention

The session state file is `.pm/dev-sessions/{slug}.md` where `{slug}` comes from the current branch name (e.g., `feat/add-auth` → `.pm/dev-sessions/add-auth.md`). To find it: derive slug from `git branch --show-current`, stripping the `feat/`/`fix/`/`chore/` prefix. If not found, check legacy path `.dev-state-{slug}.md`.

## References

The following reference files provide detailed guidance for specific ship phases:

| Reference | Purpose |
|-----------|---------|
| `${CLAUDE_PLUGIN_ROOT}/skills/ship/references/review.md` | Review agent configuration and execution |
| `${CLAUDE_PLUGIN_ROOT}/skills/ship/references/handling-feedback.md` | Handling PR review feedback (M/L/XL) |
| `${CLAUDE_PLUGIN_ROOT}/references/merge-loop.md` | Shared self-healing merge loop procedure |

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "Code looks clean, skip review" | Clean code can have wrong behavior. Review checks intent, not style. |
| "Just push, CI will catch issues" | CI catches syntax. Review catches logic, security, and architectural drift. |
| "Small change, PR description can be brief" | PR description is for the reviewer, not the author. Brief = reviewer misses context. |
| "Tests pass locally, skip CI wait" | Local passes with local state. CI is the clean-room test. |
| "Auto-merge is fine, I trust the gates" | Trust but verify. Check merge state is MERGED, not just armed. |

