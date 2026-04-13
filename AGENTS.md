# AGENTS.md

Repo guide for AI agents and contributors working in the `pm` plugin repository.

## Purpose

This repository contains the PM plugin itself, not a product that uses the plugin.

Use this file for repo conventions only. Do not treat it as the runtime source of truth for plugin behavior.

## Plugin Source

This repo is for the plugin source code that gets published and installed by users.

Treat these directories as the runtime surface:

| Directory | Contents |
|---|---|
| `commands/` | User-facing command surface |
| `skills/` | Workflow behavior and output expectations |
| `personas/` | Role overlays used by review and critique agents |
| `scripts/` | Runtime utilities (helpers, validators, status) |
| `hooks/` | Pre/post tool-use hooks |
| `templates/` | Output templates |
| `tests/` | Script and regression tests |
| `.claude-plugin/plugin.json` | Claude Code plugin manifest |
| `README.md`, `.codex/INSTALL.md` | Public docs and install guides |

Do not treat this repository itself as a PM project with its own checked-in `pm/`
or `.pm/` directories. Those are consumer-project data, not plugin source code.

## Plugin Architecture

Three copies of the plugin exist on disk. Understand which you're touching:

```
Source (this repo)              Marketplace (git clone)                   Cache (installed copy)
<repo-root>/                →   ~/.claude/plugins/marketplaces/pm/    →   ~/.claude/plugins/cache/pm/pm/{version}/
     ↑                                   ↑                                         ↑
  You edit here                   Auto-synced from GitHub                  What actually runs
```

### How changes flow

```
Edit source → commit → push → Claude Code updates marketplace → reinstall updates cache
```

The **cache** is what Claude Code actually loads at runtime. The **marketplace** is a git clone of the GitHub repo. The **source** is where you develop.

## Branching Rules

**Never push directly to main.** All changes go through a PR.

```
feature branch: commit → commit → bump version (last commit) → PR → merge to main
```

- Create a feature branch for all work
- Commit freely on the branch — no version bumps until ready
- **Bump version as the last commit** on the branch before creating the PR
- Create a PR, merge to main
- After merge, delete the remote branch (`gh pr merge` does this by default) and clean up locally:
  ```bash
  git checkout main && git pull && git branch -d <branch-name>
  ```
- The pre-push hook enforces this — direct pushes to main are blocked

## Git Hooks

Hooks live in `.githooks/` (version-controlled). After cloning, activate them:

```bash
git config core.hooksPath .githooks
```

| Hook | What it does |
|---|---|
| `pre-push` | Blocks direct pushes to main; verifies git tag exists for manifest version |
| `pre-commit` | Validates JSON, version consistency across all 3 manifests, and `pm/` artifact schemas when a project knowledge base is present |

## Development Flow

### Editing source code (skills, scripts, commands, personas)

1. **Edit** files in this repo
2. **Sync to cache** to test immediately (see sync command below)
3. **Verify** the change works (run the skill, check tests, etc.)
4. **Commit** to the source repo when satisfied
5. **Bump version** as the last commit on the branch, then create a PR (see version bump rules below)

### Sync command (dev only)

To copy source changes to the plugin cache for immediate testing:

```bash
rsync -av --delete \
  --exclude='.git' --exclude='pm/' --exclude='.pm/' --exclude='.planning/' --exclude='node_modules/' \
  <repo-root>/ \
  ~/.claude/plugins/cache/pm/pm/{version}/
```

This overwrites the cache with your local source. It will be overwritten again on the next official plugin update, which is fine — your changes should be committed to source before that happens.

**Never edit the cache directly.** Always edit source, then sync.

### Editing project data

PM writes to `pm/` and `.pm/` in the consuming project, not in the plugin source repository.

## Source Of Truth

Runtime behavior lives in:
- `commands/`
- `skills/`
- `scripts/`
- `personas/`

Public product promise lives in:
- `README.md`
- platform install guides such as `.codex/INSTALL.md`

Planning notes live in:
- `docs/plans/`

`.planning/` is committed and reviewable, but it is not runtime behavior.

## Change Rules

- If command behavior changes, update the corresponding file in `commands/`.
- If workflow behavior changes, update the relevant `skills/` file.
- If persona behavior changes, update the relevant file in `personas/`.
- If code changes affect the published UX, update `README.md` and any affected install docs.
- Keep command names and examples aligned across `README.md`, `commands/`, and `skills/`.
- **After editing scripts or skills, sync to cache before testing.** Do not edit the cache directly.

## Version Bump Rules

When the user says **"bump version"** or **"bump patch"**: increment the **patch** number (e.g., 1.0.5 → 1.0.6). This is the default and most common bump.

| User says | Semver meaning | Example |
|---|---|---|
| "bump version" / "bump patch" | Patch | 1.0.5 → 1.0.6 |
| "bump minor" | Minor | 1.0.5 → 1.1.0 |
| "bump major" | Major | 1.0.5 → 2.0.0 |

All version bumps must update **all 3 manifests** and **create a git tag**:
- `.claude-plugin/plugin.json`
- `.claude-plugin/marketplace.json`
- `.codex-plugin/plugin.json`
- Run `git tag v{new_version}` after committing the bump

Read the current version from `.claude-plugin/plugin.json` before bumping — do not assume the version number.

The pre-push hook will block pushes if the tag is missing.

## Data Rules

- Never commit real credentials.
- Never commit private customer evidence or raw exports.
- Private machine/runtime data belongs in `.pm/` in the consuming project, not in this repo.
- Human-facing plugin outputs belong in `pm/` in the consuming project, not in this repo.

## Testing

- When changing `scripts/`, run the relevant tests in `tests/`.
- Prefer adding regression coverage for bugs in parsing, server behavior, security, and CLI contracts.
- If behavior is cross-platform or shell-sensitive, verify both the script contract and the test coverage.

## Planning Notes

- Prefer dated filenames in `docs/plans/`.
- Delete or archive stale planning notes once implemented.
- Do not confuse `docs/` files with runtime plugin instructions.

## Step Authoring Rules

Every step file in `skills/*/steps/*.md` must meet a minimum thickness bar. A step that is too thin gives the agent no decision criteria — it improvises instead of executing.

### Required sections

Every step must contain these three elements (as explicit sections, inline annotations, or clearly embedded in the prose):

1. **Goal** — one sentence stating what this step produces or decides. The agent reads this to know whether the step is relevant or already satisfied.
2. **How** — the procedure, heuristic, or decision criteria. Not just a template — guidance on *how to do it well*. If the step delegates to a reference file, the How is "Read and follow `{path}`" plus any inline context the agent needs before opening that file.
3. **Done-when** — exit criteria so the agent knows when to advance. Can be a checklist, a single condition, or "user confirms." Without this, the agent either lingers or skips prematurely.

### Delegation steps

Steps that delegate to a reference file (`"Read and follow X"`) are valid. They must still state the **Goal** and **Done-when** inline — the agent should not need to open the reference file just to know whether to enter the step.

### What "thin" looks like (avoid)

- A step that is only a template with no guidance on filling it in
- A step that lists options but gives no criteria for choosing between them
- A step that ends without telling the agent what state must be true before advancing
- A step whose entire How section is a single sentence like "Do the thing"

### Conversational steps

Steps in conversational skills (think, strategy interview) are lighter than procedural steps — that is expected. But even a conversational beat needs a Goal ("surface the real problem"), a How ("pick the one forcing question that matters most"), and a Done-when ("user confirms the reframe resonates, or redirects").

## When Unsure

- Favor the smallest change that keeps runtime files, docs, and tests aligned.
- Prefer clearer structure over adding new top-level concepts unless they materially improve the product.
- If you're not sure whether to edit source or cache: **always edit source.**
