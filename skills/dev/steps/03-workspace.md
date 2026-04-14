---
name: Workspace
order: 3
description: Set up isolated git worktree, install deps, verify clean baseline
---

## Workspace (all sizes)

## Goal

Prepare a clean, correctly-based branch/worktree and a verified baseline before any implementation starts.

Set up an isolated git worktree for every task — including XS. Worktree isolation prevents agents from mixing up branches, committing to the wrong branch, or stepping on parallel work. The overhead is seconds; the cost of a wrong-branch commit is much higher.

1. Resolve context:
   - `REPO_ROOT=$(git rev-parse --show-toplevel)`
   - `CURRENT_BRANCH=$(git branch --show-current)`
2. If already on a feature branch inside a worktree, reuse it.
3. **Preflight: ensure new branches are based on the default branch.**
   Before creating a new worktree, verify the starting point:
   ```bash
   git fetch origin
   # Create worktree from the default branch, not the current branch
   git worktree add ${REPO_ROOT}/.worktrees/<slug> -b <type>/<slug> origin/${DEFAULT_BRANCH}
   ```
   This prevents accidentally basing a new feature branch on another feature branch (e.g., if the user is currently on `feat/landing-page`, the new branch would carry over those unmerged commits). Always branch from `origin/${DEFAULT_BRANCH}` to get a clean starting point.
4. Else derive a slug from ticket/topic and propose:
   - branch: `<type>/<slug>` (`feat/`, `fix/`, `chore/`)
   - worktree: `${REPO_ROOT}/.worktrees/<slug>`
5. If branch/worktree already exists:
   - Reuse existing branch + worktree when valid
   - If occupied or ambiguous, suffix branch/worktree with `-v2`, `-v3`
6. Record final `repo root`, `cwd`, `branch`, and `worktree` in `.pm/dev-sessions/{slug}.md`.
7. **Update local backlog status to in-progress:**

   <HARD-RULE>
   If `{pm_dir}/backlog/{slug}.md` exists, you MUST update it now. Do not defer this to later.
   </HARD-RULE>

   a. Read `{pm_dir}/backlog/{slug}.md`. If it exists and `status` is not already `in-progress` or `done`:
      - Set `status: in-progress` in frontmatter
      - Set `updated: {today's date}` in frontmatter
      - If `linear_id` is available in session state and not already in frontmatter, add it

   b. If the backlog item has a `parent` field, find `{pm_dir}/backlog/{parent-slug}.md` and set its `status: in-progress` too (if not already `in-progress` or `done`).

   Log: `Backlog: {pm_dir}/backlog/{slug}.md → in-progress`

### Worktree environment prep

After worktree creation, prep the environment based on what the project needs.

**Read AGENTS.md** (and any app-specific AGENTS.md) for workspace setup commands. Common patterns:

| Pattern | Detection | Action |
|---------|-----------|--------|
| Dependency install | `package.json` exists, `node_modules` missing | `pnpm install` / `npm install` / `yarn` |
| Dependency install | `Gemfile` exists, gems missing | `bundle install` |
| Code generation | AGENTS.md lists codegen commands | Run them (API specs, types, schemas) |
| Shared package build | Monorepo with shared packages | Build shared packages before consuming apps |
| Database setup | AGENTS.md lists DB commands | Run migrations if needed |

If AGENTS.md doesn't specify workspace setup, fall back to: install dependencies + run the project's test command once to verify the worktree is functional.

### Workspace verification (mandatory)

After prep, run the project's test command (from AGENTS.md) to confirm the worktree is functional:

```bash
# Example: detect and run the right test command
if [ -f "package.json" ]; then
  # Check for test script in package.json
  npm test  # or pnpm test, yarn test
elif [ -f "Gemfile" ]; then
  bundle exec rails test
elif [ -f "pyproject.toml" ]; then
  pytest
fi
```

If tests fail at this point, the worktree setup is broken — not your changes. Try to fix the environment issue (missing deps, stale codegen, etc.). If the baseline cannot be fixed, escalate per SKILL.md: "Worktree tests fail before I've changed anything. Here's what I see: {errors}. Fix the baseline first, or proceed with known failures?"

Record the baseline test outcome in the session file (pass, or which tests failed).

## Done-when

The final repo root, branch, cwd, worktree, backlog status, and baseline test result are recorded in the session state, and implementation can begin from a verified clean baseline.

**Advance:** proceed to Step 4 (Groom Readiness).
