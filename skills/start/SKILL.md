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

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for telemetry and interaction pacing. Do not use its generic path resolution section here — `pm:start` resolves paths itself below before loading any steps.

Read `${CLAUDE_PLUGIN_ROOT}/references/writing.md` before generating any output.

## Iron Law

**NEVER GUESS PM PATHS.** `pm:start` exists to resolve `pm_dir`, `pm_state_dir`, and `source_dir` correctly before any other skill starts reading or writing. If path resolution is uncertain, stop and resolve it here first.

**Workflow:** `start` | **Telemetry steps:** `detect-situation`, `bootstrap`, `resume`, `pulse`.

**Steps:** Read all `.md` files from `${CLAUDE_PLUGIN_ROOT}/skills/start/steps/` in numeric filename order. If `.pm/workflows/start/` exists, same-named files there override defaults. Execute each step in order — each step contains its own instructions.

**When NOT to use:** When the user has a specific task in mind — route to the relevant skill directly. Start is for bootstrapping or resuming, not for "I want to build X" or "research Y."

## Red Flags — Self-Check

If you catch yourself thinking any of these, you're drifting off-skill:

- **"I can infer the PM repo layout from context."** Path inference is exactly what `pm:start` is supposed to remove. Resolve it explicitly.
- **"The project is probably initialized already, skip detection."** Start is valuable because it detects bootstrap vs resume vs pulse correctly. Skipping that means routing blind.
- **"I'll route into a workflow before showing the current state."** The session brief is part of the value. Users need to see what start detected before the next handoff.
- **"Separate-repo mode is rare, I can ignore it."** It changes where state and backlog files live. Ignoring it means writing to the wrong repo.
- **"No active work found means there's nothing useful to say."** Pulse mode exists to recommend the next useful lane when there is no active session to resume.

## Escalation Paths

- **PM is not initialized and the user did not ask to initialize it:** "PM isn’t initialized in this repo yet. Want to run `/pm:start` to set it up, or continue without PM?"
- **Resolved PM repo path is missing:** "The configured PM repo path doesn’t exist anymore. Want to update separate-repo config with `/pm:setup`, or fall back to bootstrap here?"
- **Resolved source repo path is missing:** "The linked source repo path can’t be found. PM can still open the knowledge base, but code-aware flows will be degraded until `/pm:setup separate-repo` is fixed."

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

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "PM is already set up, skip start" | Start's resume mode catches stale state and surfaces active work. Skipping means flying blind. |
| "I'll just read the config myself" | Path resolution has 4 modes. Start handles all of them. DIY resolution drifts. |
| "User knows where they left off" | Users forget. Pulse surfaces what changed since last session. |

## Before Marking Done

- [ ] All three paths resolved and output to conversation (pm_dir, pm_state_dir, source_dir)
- [ ] Correct mode detected (bootstrap, resume, or separate-repo)
- [ ] User routed to next action (bootstrap wizard, active work, or pulse)
