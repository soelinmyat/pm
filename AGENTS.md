# AGENTS.md

Repo guide for AI agents and contributors working in the `pm` plugin repository.

## Purpose

This repository contains the PM plugin itself, not a product that uses the plugin.

Use this file for repo conventions only. Do not treat it as the runtime source of truth for plugin behavior.

## Two Roles, One Repo

This repo serves two purposes simultaneously. Keep them separate:

### 1. Plugin source code (the product)

The plugin codebase that gets published and installed by users.

| Directory | Contents |
|---|---|
| `commands/` | User-facing command surface |
| `skills/` | Workflow behavior and output expectations |
| `agents/` | Delegated/subagent behavior |
| `scripts/` | Runtime utilities (dashboard server, helpers) |
| `hooks/` | Pre/post tool-use hooks |
| `templates/` | Output templates |
| `tests/` | Script and regression tests |
| `.claude-plugin/plugin.json` | Claude Code plugin manifest |
| `.cursor-plugin/plugin.json` | Cursor plugin manifest |
| `README.md`, `GEMINI.md`, `.codex/INSTALL.md` | Public docs and install guides |

### 2. Dogfooded knowledge base (using the product on itself)

The `pm/` directory at the repo root is the knowledge base created by running PM commands on this project. It is product data, not source code.

| Path | Contents |
|---|---|
| `pm/strategy.md` | Product strategy for PM itself |
| `pm/landscape.md` | Market landscape |
| `pm/competitors/` | Competitor profiles |
| `pm/research/` | Topic research |
| `pm/backlog/` | Backlog issues (ideas, groomed, shipped) |

The `.pm/` directory (gitignored) contains private runtime state like groom sessions and config.

**Rule:** Never confuse editing plugin source code (`skills/`, `scripts/`) with editing dogfooded data (`pm/`). They have different change flows.

## Plugin Architecture

Three copies of the plugin exist on disk. Understand which you're touching:

```
Source (this repo)          Marketplace (git clone)           Cache (installed copy)
/Users/.../Projects/pm/  →  ~/.claude/plugins/marketplaces/pm/  →  ~/.claude/plugins/cache/pm/pm/{version}/
     ↑                              ↑                                      ↑
  You edit here              Auto-synced from GitHub             What actually runs
```

### How changes flow

```
Edit source → commit → push → Claude Code updates marketplace → reinstall updates cache
```

The **cache** is what Claude Code actually loads at runtime. The **marketplace** is a git clone of the GitHub repo. The **source** is where you develop.

## Development Flow

### Editing source code (skills, scripts, commands, agents)

1. **Edit** files in this repo (`/Users/.../Projects/pm/`)
2. **Sync to cache** to test immediately (see sync command below)
3. **Verify** the change works (restart dashboard, run the skill, etc.)
4. **Commit** to the source repo when satisfied
5. **Bump version** and push when ready to release (see version bump rules below)

### Sync command (dev only)

To copy source changes to the plugin cache for immediate testing:

```bash
rsync -av --delete \
  --exclude='.git' --exclude='pm/' --exclude='.pm/' --exclude='.planning/' --exclude='node_modules/' \
  /Users/soelinmyat/Projects/pm/ \
  ~/.claude/plugins/cache/pm/pm/{version}/
```

This overwrites the cache with your local source. It will be overwritten again on the next official plugin update, which is fine — your changes should be committed to source before that happens.

**Never edit the cache directly.** Always edit source, then sync.

### Editing dogfooded data (pm/)

When using `/pm:groom`, `/pm:research`, `/pm:ideate`, etc., the plugin writes to `pm/` in this repo. That's normal — it's the knowledge base. Commit it alongside source changes when it represents intentional product decisions (strategy, backlog items). Don't commit temporary groom state (`.pm/.groom-state.md`).

### Dashboard testing

After syncing source to cache, restart the dashboard to pick up changes:

```bash
node ~/.claude/plugins/cache/pm/pm/{version}/scripts/server.js \
  --mode dashboard --dir "$PWD/pm"
```

## Source Of Truth

Runtime behavior lives in:
- `commands/`
- `skills/`
- `agents/`
- `scripts/`

Public product promise lives in:
- `README.md`
- platform install guides such as `.codex/INSTALL.md` and `GEMINI.md`

Planning notes live in:
- `.planning/`

`.planning/` is committed and reviewable, but it is not runtime behavior.

## Change Rules

- If command behavior changes, update the corresponding file in `commands/`.
- If workflow behavior changes, update the relevant `skills/` file.
- If delegated agent behavior changes, update the relevant file in `agents/`.
- If code changes affect the published UX, update `README.md` and any affected install docs.
- Keep command names and examples aligned across `README.md`, `commands/`, and `skills/`.
- **After editing scripts or skills, sync to cache before testing.** Do not edit the cache directly.

## Version Bump Rules

When the user says **"bump version"**, **"bump patch"**, or **"bump minor version"**: increment the **patch** number (e.g., 1.0.5 → 1.0.6). This is the default and most common bump.

| User says | Semver meaning | Example |
|---|---|---|
| "bump version" / "bump patch" / "bump minor version" | Patch | 1.0.5 → 1.0.6 |
| "bump minor" (explicit semver) | Minor | 1.0.5 → 1.1.0 |
| "bump major" | Major | 1.0.5 → 2.0.0 |

All version bumps must update **all 3 manifests**:
- `.claude-plugin/plugin.json`
- `.cursor-plugin/plugin.json`
- `.claude-plugin/marketplace.json`

Read the current version from `.claude-plugin/plugin.json` before bumping — do not assume the version number.

## Data Rules

- Never commit real credentials.
- Never commit private customer evidence or raw exports.
- Private machine/runtime data belongs in `.pm/` in the consuming project, not in this repo.
- Human-facing plugin outputs belong in `pm/` in the consuming project (committed as dogfooded data in this repo).

## Testing

- When changing `scripts/`, run the relevant tests in `tests/`.
- Prefer adding regression coverage for bugs in parsing, server behavior, security, and CLI contracts.
- If behavior is cross-platform or shell-sensitive, verify both the script contract and the test coverage.

## Planning Notes

- Prefer dated filenames in `.planning/`.
- Delete or archive stale planning notes once implemented.
- Do not confuse `.planning/` files with runtime plugin instructions.

## When Unsure

- Favor the smallest change that keeps runtime files, docs, and tests aligned.
- Prefer clearer structure over adding new top-level concepts unless they materially improve the product.
- If you're not sure whether to edit source or cache: **always edit source.**
