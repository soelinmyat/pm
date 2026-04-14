---
name: Pre-flight
order: 1
description: Verify branch, check uncommitted changes, detect default branch, and validate prerequisites
---

## Pre-flight

<!-- telemetry step: pre-flight -->

**Goal:** Verify the working tree is ready to ship: correct branch, clean state, required tools available.

**Done-when:** On a feature branch (not `{DEFAULT_BRANCH}`), working tree is clean (all changes committed), `gh` is authenticated, and `{DEFAULT_BRANCH}` is detected.

### Prerequisites

Before starting, verify required tools are available:

```bash
command -v gh >/dev/null 2>&1 || { echo "GitHub CLI (gh) is required for PR creation and merging. Install: https://cli.github.com"; exit 1; }
command -v git >/dev/null 2>&1 || { echo "git is required."; exit 1; }
```

If `gh` is missing, tell the user: "Ship requires GitHub CLI. Install it from https://cli.github.com and run `gh auth login`."

If `gh auth status` fails, tell the user: "GitHub CLI is not authenticated. Run `gh auth login` first."

### Default Branch

Read `{DEFAULT_BRANCH}` from `.pm/dev-sessions/{slug}.md` if available. Otherwise detect:

```bash
DEFAULT_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
[ -z "$DEFAULT_BRANCH" ] && DEFAULT_BRANCH=$(git remote show origin 2>/dev/null | grep 'HEAD branch' | awk '{print $NF}')
[ -z "$DEFAULT_BRANCH" ] && DEFAULT_BRANCH="main"  # fallback only
```

All git commands use `{DEFAULT_BRANCH}` — never hardcode `main`.

### Verify branch

Run `git branch --show-current`. If on `{DEFAULT_BRANCH}`:
- STOP. Report: "You are on {DEFAULT_BRANCH}. Create a feature branch first."

### Check for uncommitted changes

Run `git status --porcelain`.

If there are uncommitted changes:
1. Show the user what's changed: `git diff --stat`
2. STOP and ask what they want to do next:
   - commit the changes first
   - keep shipping blocked until the worktree is clean
3. Do not stage or commit on the user's behalf from this step. Ship starts from committed code.

If working tree is clean, continue.
