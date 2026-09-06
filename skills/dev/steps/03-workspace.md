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

## How

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
      - If its frontmatter contains `reasoning_version: 2`, refresh the authenticated reader binding from the final Markdown bytes before validation:
        ```bash
        node "${CLAUDE_PLUGIN_ROOT}/scripts/product-reasoning.js" refresh-reader \
          --root "{pm_dir}" \
          --decision "backlog/{slug}.decision.json"
        ```

   b. If the backlog item has a `parent` field, find `{pm_dir}/backlog/{parent-slug}.md` and set its `status: in-progress` too (if not already `in-progress` or `done`).
      Apply the same `refresh-reader` command to the parent's canonical companion when the parent is a v2 reasoning artifact.

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

### Workspace verification plan (mandatory)

Create one scoped plan from the repository instructions and observed task risk before implementation. Repository-required checks always belong in the plan. Add focused behavior/regression checks for executable changes and a baseline check that can detect a broken dependency or runtime setup. For a low-risk prose-only change with no mandated tests, source/structure validation can establish the baseline; do not invent behavioral tests for prose. A full project suite is required when repository rules demand it or the risk/unknown baseline justifies it.

Save `verification-input.json` under the existing session's `workspace/` evidence directory with:

```json
{
  "stage": "baseline",
  "risk": "low",
  "executable_change": true,
  "repository_commands": ["npm run validate:plugin"],
  "focused_commands": ["node --test tests/parser.test.js"],
  "environment": null,
  "dependencies": null
}
```

Use actual commands from the repository and affected contracts; these names are examples. Map the observed Dev risk to low/medium/high, conservatively choosing high for unresolved risk. `environment` and `dependencies` may be nonempty objects of independently observed runtime/configuration and installed-dependency digests when complete identities are available. Hash sensitive values rather than storing them. Unknown or incomplete identities remain `null` and prohibit reuse; a lockfile alone is not proof of the installed dependency tree. Include ignored/generated inputs in those identities when the checks depend on them.

Generate the plan through the helper; it binds tracked and untracked nonignored source bytes as well as the command and supplied identities:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/lib/verification-plan.js" \
  --root "{worktree}" \
  --evidence-root "{originating_project_root}" \
  --input ".pm/dev-sessions/{slug}/workspace/verification-input.json" \
  --out ".pm/dev-sessions/{slug}/workspace/verification-plan.json"
```

`--root` identifies the source worktree; `--evidence-root` identifies the originating project containing the existing canonical session. Resolve input/output/receipt paths against that evidence root; do not copy or create a second session in the worktree. Run each planned command once and retain its output. Store receipts alongside existing workspace evidence as `{key, status, artifact: {path, sha256}}`; copy the plan's key only after the actual command passes and a regenerated plan confirms the same input identities before and after the run. Paths are project-relative, and hashes are SHA-256 of the retained output. A rerun can supply `--prior` with that receipt array: matching complete inputs plus unchanged passing output permit reuse. Changed code, command, runtime, dependency identities, or output invalidate reuse. Planning is not gate certification: existing TDD, QA, Review, final verification and prepared-release freshness contracts still apply. Regenerate with `stage: final` for final checks; repository-mandated final commands always run even with a matching receipt.

If a check fails before implementation, preserve the baseline failure, diagnose missing dependencies or stale generated inputs, and repair authorized environment setup. Distinguish an existing product failure from environment failure using evidence. Continue independent work when possible; request a scope decision only when an unresolved failure prevents meaningful verification. Do not silently claim a passing baseline.

Record the plan, retained command outcomes, source/environment/dependency identity limits, and any known failures in the existing workspace evidence. Once the required checks pass, broaden or repeat them only for changed inputs, a mandatory later gate, or a concrete unresolved concern. Continue after repo root, branch, cwd, worktree, backlog state, and the scoped baseline are verified.

## Done-when

The isolated branch/worktree, repository instructions, dependency baseline, and source/session paths are recorded and verified.

**Advance:** proceed to Step 04 (Groom Readiness).
