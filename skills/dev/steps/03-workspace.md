---
name: Workspace
order: 3
description: Set up isolated git worktree, install deps, verify clean baseline
phase: workspace
requires:
  - execution-defaults.md
gates: []
required_capabilities:
  - local_writes
required_evidence:
  - workspace
requires_commit: false
allowed_modes:
  - inline
result_schema: phase-result-v1
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
6. Record the verified worktree atomically; never hand-edit source paths in JSON:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/dev-session.js" workspace \
     --session "{absolute_session_path}" \
     --worktree "${REPO_ROOT}/.worktrees/<slug>"
   ```
   Continue using the absolute session path returned by `init`; it remains in the originating repository even after cwd moves into the feature worktree.
7. **Update local backlog status to in-progress:**

   **Loop worker branch:** If `PM_LOOP_WORKER=1`, skip this backlog write (including the parent write) and log `Backlog write: skipped-loop-worker`. The loop worker already owns the durable claim and is the only process allowed to finalize card state. Continue with worktree prep and every implementation/quality gate below.

   <HARD-RULE>
   Outside Loop Worker Mode, if `{pm_dir}/backlog/{slug}.md` exists, you MUST update it now. Do not defer this to later.
   </HARD-RULE>

   a. Read `{pm_dir}/backlog/{slug}.md`. If it exists and `status` is not already `in-progress` or `done`:
      - Set `status: in-progress` in frontmatter
      - Set `updated: {today's date}` in frontmatter
      - If `linear_id` is available in session state and not already in frontmatter, add it

   b. If the backlog item has a `parent` field, find `{pm_dir}/backlog/{parent-slug}.md` and set its `status: in-progress` too (if not already `in-progress` or `done`).

   Log: `Backlog: {pm_dir}/backlog/{slug}.md → in-progress`

### Worktree environment prep

After worktree creation, prep the environment based on what the project needs.

**Prime the worktree (loop bootstrap parity).** Fresh worktrees miss gitignored-but-required files (env files, generated specs) — the top recurring field failure. If `{pm_dir}/loop/config.json` defines `worker.bootstrap_files` / `worker.bootstrap_command`, copy/run them into the new worktree with the same helper the loop worker uses, before installing dependencies:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/worktree-bootstrap.js \
  --git-root "$REPO_ROOT" \
  --worktree "$REPO_ROOT/.worktrees/<slug>" \
  --pm-dir {pm_dir} \
  --pm-state-dir {pm_state_dir}
```

Repos without a loop config are a silent no-op (no `worker.bootstrap_*` keys → nothing copied). This reuses the loop's `worker.bootstrap_files`/`bootstrap_command` keys — do not introduce a second set.

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

Once the repo root, branch, cwd, worktree, backlog status, and baseline test
result are recorded and implementation can begin from a verified clean
baseline, proceed to Step 04 (Groom Readiness).

## Done-when

The isolated branch/worktree, repository instructions, dependency baseline, and source/session paths are recorded and verified.

**Advance:** proceed to Step 04 (Groom Readiness).
