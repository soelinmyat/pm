---
name: start
description: "Use to bootstrap PM in a new repo or resume active work. Auto-invoked at session start by using-pm."
---

# pm:start

## Purpose

`pm:start` is the main entry point for PM.

Use it to do one of two things:

1. **Bootstrap** PM in a repo that does not have a PM workspace yet
2. **Resume** active work in an initialized PM repo

`pm:start` should feel like "start PM here" — not "run a setup wizard."

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution and runtime conventions.

**Workflow:** `start`

**Steps:** Read all `.md` files from `${CLAUDE_PLUGIN_ROOT}/skills/start/steps/` in numeric filename order. If `.pm/workflows/start/` exists, same-named files there override defaults.

**When NOT to use:** When the user has a specific task in mind — route to the relevant skill directly. Start is for bootstrapping or resuming, not for "I want to build X" or "research Y."

## Hard rules

- Never guess PM paths — resolve `pm_dir`, `pm_state_dir`, and `source_dir` here before any other skill reads or writes. If resolution is uncertain, stop and resolve it first.
- Never `mkdir` `pm_dir` itself; skills verify `{pm_dir}` exists before writing, so nothing lands in the wrong repo. Session files (groom, rfc, dev) always live source-side at `{source_dir}/.pm/*-sessions/`, never in the PM repo.
- Detect the situation (bootstrap vs resume vs pulse) and show the session brief before routing — don't hand off blind.

## Escalation Paths

- **PM is not initialized and the user did not ask to initialize it:** "PM isn’t initialized in this repo yet. Want to run `/pm:start` to set it up, or continue without PM?"
- **Resolved PM repo path is missing:** "The configured PM repo path doesn’t exist anymore. Want to update separate-repo config with `/pm:setup`, or fall back to bootstrap here?"
- **Resolved source repo path is missing:** "The linked source repo path can’t be found. PM can still open the knowledge base, but code-aware flows will be degraded until `/pm:setup separate-repo` is fixed."

## Resolve Paths

Every skill depends on three paths — resolve them here, before loading steps, so nothing downstream guesses:

- `pm_dir` — the `pm/` knowledge base directory
- `pm_state_dir` — the `.pm/` runtime state directory (config, preferences, sync status), always in the same repo as `pm_dir`
- `source_dir` — the source repo root, where branches, builds, and session files live

Run the resolver and trust its output — it handles same-repo mode and separate-repo mode (nested and flat layouts) and worktrees from a single source of truth:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/resolve-pm-dir.js --json
# → {"pmDir":"...","pmStateDir":"..."}
```

`source_dir` is cwd, unless `.pm/config.json` has `source_repo.path` (running from a separate PM repo), in which case it is that resolved path. Output all three paths into the conversation in every mode.

**Fallback if the resolver can't run:** if `pm/` exists at cwd, use it (same-repo mode); if not, tell the user "Run /pm:start first to configure paths" and stop. If a configured separate-repo path is missing, warn and offer `/pm:setup` — don't crash.
