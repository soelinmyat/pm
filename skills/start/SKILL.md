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

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for workflow loading, telemetry, and interaction pacing. Do not use its generic path resolution section here — `pm:start` resolves paths itself below before loading any steps.

**Workflow:** `start` | **Telemetry steps:** `detect-situation`, `bootstrap`, `resume`, `open`, `pulse`.

Execute the loaded workflow steps in order. Each step contains its own instructions.

## Detect Repo Mode

Every skill in PM depends on three path variables — `pm_dir`, `pm_state_dir`, and `source_dir`. Getting these wrong means every downstream read and write lands in the wrong place. Resolve them first, before anything else.

PM can run in two modes:

- **Same-repo mode:** The `pm/` knowledge base lives in the same repo as the source code.
- **Separate-repo mode:** The `pm/` knowledge base lives in a different repo, linked via config.

### Variable Definitions

- `pm_dir` — absolute path to the `pm/` knowledge base directory
- `pm_state_dir` — absolute path to the `.pm/` runtime state directory (always in the same repo as `pm_dir`)
- `source_dir` — absolute path to the source repo root

### Resolution Logic

1. Read `.pm/config.json` at the current working directory (cwd).

2. **If config contains `pm_repo.path`** (running from a source repo pointing to a separate PM repo):
   - Resolve `pm_repo.path` relative to the directory containing `.pm/config.json` (i.e., relative to `.pm/`)
   - Set `pm_dir` = `{resolved_pm_repo_path}/pm`
   - Set `pm_state_dir` = `{resolved_pm_repo_path}/.pm`
   - Set `source_dir` = `{cwd}`
   - Validate the resolved PM repo path exists (`test -d {resolved_pm_repo_path}/pm`). If it does not exist, warn: "PM repo at {resolved_pm_repo_path} not found. Run `pm:setup` to update." Do not crash — fall through to bootstrap offer.

3. **If config contains `source_repo.path`** (running from the PM repo pointing to a separate source repo):
   - Resolve `source_repo.path` relative to the directory containing `.pm/config.json` (i.e., relative to `.pm/`)
   - Set `pm_dir` = `{cwd}/pm`
   - Set `pm_state_dir` = `{cwd}/.pm`
   - Set `source_dir` = `{resolved_source_repo_path}`
   - Validate the resolved source repo path exists (`test -d {resolved_source_repo_path}`). If it does not exist, warn: "Source repo at {resolved_source_repo_path} not found. Run `pm:setup` to update." Continue normally — PM can still function without the source repo.

4. **If neither field exists** (same-repo mode — the default):
   - Set `pm_dir` = `{cwd}/pm`
   - Set `pm_state_dir` = `{cwd}/.pm`
   - Set `source_dir` = `{cwd}`

5. **If `.pm/config.json` does not exist and `pm/` does not exist at cwd:**
   - Leave all three variables unset. The Detect The Situation step will route to Bootstrap Mode.

### Output Resolved Paths

After resolution, output all three paths into the conversation so downstream skills can reference them:

```
PM directory: {pm_dir}
PM state: {pm_state_dir}
Source directory: {source_dir}
```

This output is required in ALL modes, including same-repo mode. It ensures every downstream skill has explicit paths and never needs to guess.

### Canonical Fallback Paragraphs

These two paragraphs are the single source of truth for path fallback logic. They are included verbatim in every skill that reads or writes PM files (added during Issues #7 and #8):

**pm_dir fallback:** "If `pm_dir` is not in conversation context, check if `pm/` exists at cwd. If yes, use it (same-repo mode). If no, tell the user: 'Run pm:start first to configure paths.' Do not proceed without a valid path."

**pm_state_dir fallback:** "If `pm_state_dir` is not in conversation context, use `.pm` at the same location as `pm_dir`'s parent (i.e., if `pm_dir` = `{base}/pm`, then `pm_state_dir` = `{base}/.pm`). This ensures preference reads and session writes always resolve to the PM repo's `.pm/` directory."

### Structural Enforcement

Skills that write files to `pm_dir` (groom, ingest, research, strategy) must verify the target directory exists (`test -d {pm_dir}`) before writing. If the directory does not exist, the skill emits an error: "PM directory at {pm_dir} does not exist. Run `pm:start` to configure paths."

This is a structural guard — `mkdir -p` is never used to create `pm_dir` itself (only subdirectories within a confirmed `pm_dir`). This prevents silent file creation in the wrong repo.
