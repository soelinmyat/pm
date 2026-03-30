---
name: merge
description: "Self-healing PR merge — fix CI, resolve review comments, handle conflicts, and keep going until merged."
allowed-tools:
  - Bash
  - Read
  - Edit
  - Write
  - Grep
  - Glob
  - Agent
  - AskUserQuestion
---

# /merge

Compatibility alias for the shared PM merge workflow. Keep behavior in the shared merge references and ship flow; this file exists only for platforms that still expose command aliases.

Take the current PR from whatever state it's in to merged. Fix CI failures, resolve review comments (reply + resolve threads), handle merge conflicts, and keep iterating until it's done.

## How

Read and follow `${CLAUDE_PLUGIN_ROOT}/references/merge-loop.md` — it contains the full merge loop procedure.

## Default Branch

```bash
DEFAULT_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
[ -z "$DEFAULT_BRANCH" ] && DEFAULT_BRANCH=$(git remote show origin 2>/dev/null | grep 'HEAD branch' | awk '{print $NF}')
[ -z "$DEFAULT_BRANCH" ] && DEFAULT_BRANCH="main"
```
