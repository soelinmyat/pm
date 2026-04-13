---
name: ship
description: "Use when shipping committed changes — review, push, PR, CI monitor, and auto-merge in one flow. Also handles existing PRs to completion."
---

# /ship

Complete shipping lifecycle in one command: review, push, create PR, monitor CI, poll readiness gates, and auto-merge.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution, telemetry, and interaction pacing.

**Workflow:** `ship` | **Telemetry steps:** `pre-flight`, `conflict-check`, `review`, `push`, `create-or-detect-pr`, `merge-monitor`, `cleanup`.

**Steps:** Read all `.md` files from `${CLAUDE_PLUGIN_ROOT}/skills/ship/steps/` in numeric filename order. If `.pm/workflows/ship/` exists, same-named files there override defaults. Execute each step in order — each step contains its own instructions.

**When NOT to use:** Checking PR status ("what's the status of my PR?"), when changes aren't committed yet, or when the user just wants to push without review. Ship runs the full review-push-PR-merge lifecycle — if they only need `git push`, they don't need this skill.

**Also handles existing PRs.** If a PR already exists for the current branch, ship skips creation and jumps straight to gate monitoring — resolving review comments, fixing CI failures, and iterating until the PR is mergeable. Use this when you need to babysit a PR to completion.

## State File

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

## Before Marking Done

- [ ] PR created with meaningful title and description
- [ ] CI passed (not just "running")
- [ ] Review comments evaluated and addressed (not blindly resolved)
- [ ] Merge state verified as MERGED (not just auto-merge armed)
- [ ] Feature branch cleaned up

