# Dev Execution Defaults

Shared execution patterns for all dev flows. Referenced from SKILL.md — not loaded unless needed.

## Workspace checkpoint format

At stage start/end, print this block and mirror the same fields in `.pm/dev-sessions/{slug}.md`:

```
Checkpoint
- Repo root: <path>
- CWD: <path>
- Branch: <branch>
- Worktree: <path or "none">
- Stage: <intake/workspace/...>
- Next: <single next action>
```

## Path and command preflight

Before running multi-step commands:
- Confirm target paths exist (`test -d`, `test -f`)
- Confirm branch/worktree context (`git branch --show-current`, `git worktree list`)
- Prefer idempotent commands (`pull --ff-only`, guarded `git branch -d`)

## Default branch detection

Never hardcode `main` as the default branch. Detect it at intake:

```bash
DEFAULT_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
[ -z "$DEFAULT_BRANCH" ] && DEFAULT_BRANCH=$(git remote show origin 2>/dev/null | grep 'HEAD branch' | awk '{print $NF}')
[ -z "$DEFAULT_BRANCH" ] && DEFAULT_BRANCH="main"  # fallback only
```

Store in the state file and use `{DEFAULT_BRANCH}` everywhere instead of literal `main`. Pass to delegated workers and reviewers in their prompts when delegation is used.

## Pre-commit validation

Before EVERY `git commit`:
1. Verify you're on the correct branch: `git branch --show-current` — must match the expected feature branch
2. Verify cwd is in the correct worktree: `git rev-parse --show-toplevel` — must match expected worktree path
3. Run the project test command (from AGENTS.md) on changed files — if tests fail, fix before committing
4. Check for untracked files that shouldn't be staged: `git status --porcelain` — review any `??` files

If any check fails, fix before committing. Do not commit broken code and hope the push hook catches it.

## Git state guard

Before starting ANY implementation work:
1. Check for uncommitted changes: `git status --porcelain`
2. If dirty state from a prior failed attempt: read the state file to understand what happened, then decide whether to commit the partial work or reset it
3. Never start fresh work on a dirty worktree — resolve the state first

## Subagent git context

Every delegated worker or reviewer prompt MUST include:
- Explicit repo root path
- Current branch name
- Worktree path (if applicable)
- Instruction: "Verify you are on branch {branch} before making changes"

## Repeated error handling

If the same root-cause error repeats twice (path missing, branch exists, permission denied):
1. Stop repeating the same command
2. Run a short diagnosis (`pwd`, `git status -sb`, `git worktree list`)
3. Switch strategy (reuse existing worktree/branch, fix path, or ask user one focused question)
