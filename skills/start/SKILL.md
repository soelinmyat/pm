---
name: start
description: "Lifecycle router for PM. For new repos, bootstrap PM and route into the best first workflow. For returning sessions, surface update status, detect in-progress work, and recommend the next move. Triggers on session start (auto-invoked by using-pm), 'start,' 'initialize pm,' 'get started,' 'show research,' 'show knowledge base,' 'open pm,' 'view pm,' 'view research.'"
---

# pm:start

## Purpose

`pm:start` is the main entry point for PM.

Use it to do one of two things:

1. **Bootstrap** PM in a repo that does not have a PM workspace yet
2. **Resume** active work in an initialized PM repo

`pm:start` should feel like "start PM here" — not "run a setup wizard."

## Telemetry (opt-in)

If analytics are enabled, read `${CLAUDE_PLUGIN_ROOT}/references/telemetry.md`.

Minimum coverage for `pm:start`:
- run start / run end for every invocation
- one step span for `detect-situation`
- one step span for the selected path: `bootstrap`, `resume`, `open`, or `pulse`

## Interaction Pacing

Ask ONE question at a time. Wait for the user's answer before asking the next.

## Detect Repo Mode

Before detecting the situation, resolve the three path variables that all downstream skills depend on. PM can run in two modes:

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

## Detect The Situation

Check these signals using the resolved paths and the current user request:

- Does `pm_dir` exist? (i.e., was `pm_dir` resolved above, and does the directory exist on disk?)
- Does `.pm/config.json` exist at cwd?
- Is the user explicitly asking to view PM?
- Did the user pass a path argument after `/pm:start`?
- Is there active work? Check for session files in BOTH locations:
  - Groom sessions: `{pm_state_dir}/groom-sessions/*.md` (always in the PM repo's `.pm/`)
  - Dev sessions: depends on repo mode:
    - **Same-repo mode** (`pm_state_dir` == `{source_dir}/.pm`): `{pm_state_dir}/dev-sessions/*.md`
    - **Separate-repo mode** (`pm_state_dir` != `{source_dir}/.pm`): check BOTH `{pm_state_dir}/dev-sessions/*.md` AND `{source_dir}/.pm/dev-sessions/*.md` — dev sessions are written to the source repo, but a stale session from before the split may exist in the PM repo

Routing:

- If `pm_dir` does not exist or `.pm/config.json` is missing, use **Bootstrap Mode**
- If the project is initialized and active work exists, use **Resume Mode**
- Otherwise use **Pulse Mode**

If this skill was auto-invoked at session start and the project is not initialized:

- Do **not** launch into a full wizard immediately.
- Say briefly that PM is not initialized in this project yet.
- Ask: "Want to start PM in this repo now with `/pm:start`?"
- If the user says yes, continue into Bootstrap Mode.
- If the user says no, stop and let them continue with whatever they asked.

If the user explicitly invoked `/pm:start`, skip the permission prompt and continue with the routed mode directly.

## Optional Starting Context

`/pm:start [path-or-starting-context]`

Interpret the argument or surrounding user message as a routing hint:

- A file or folder path → import evidence
- "market", "landscape", "industry" → market research
- "competitor", "alternatives", "compare" → competitor research
- "research X", "look into X", "investigate X" → topic research
- "think", "brainstorm", "what if", "how should we" → `pm:think`
- "groom", "feature idea", "spec", "PRD", "break this down" → `pm:groom`
- "explore", "look around", "just show me", "skip" → show session brief and stop

If no clear hint exists, ask the user what they want to do first.

## Bootstrap Mode

### Goal

Get the user to value quickly. Do not front-load integration questions.

### Flow

1. Create the minimum PM workspace
2. Ensure `.gitignore` is correct
3. Write minimal config with sensible defaults
4. Summarize what was created
5. Decide the user's first workflow
6. Route directly into that workflow

### Step 1: Create Folder Structure

Create the layered KB folders and seed each index/log file with a minimal header so the KB is self-explanatory.

```bash
mkdir -p {pm_dir}/insights/{trends,competitors,business}
mkdir -p {pm_dir}/evidence/{research,transcripts,user-feedback}
mkdir -p {pm_dir}/backlog
mkdir -p {pm_dir}/thinking
mkdir -p {pm_dir}/product
mkdir -p .pm/imports
mkdir -p .pm/evidence
mkdir -p .pm/sessions
mkdir -p .pm/groom-sessions
mkdir -p .pm/dev-sessions
```

Write each index and log file with a one-line heading (do not use `touch` — files should never be blank):

| File | Content |
|------|---------|
| `{pm_dir}/insights/trends/index.md` | `# Trends` |
| `{pm_dir}/insights/trends/log.md` | `# Trends Log` |
| `{pm_dir}/evidence/competitors/index.md` | `# Competitor Insights` |
| `{pm_dir}/evidence/competitors/log.md` | `# Competitor Insights Log` |
| `{pm_dir}/insights/business/index.md` | `# Business Insights` |
| `{pm_dir}/insights/business/log.md` | `# Business Insights Log` |
| `{pm_dir}/evidence/index.md` | `# Evidence` |
| `{pm_dir}/evidence/log.md` | `# Evidence Log` |
| `{pm_dir}/evidence/research/index.md` | `# Research` |
| `{pm_dir}/evidence/research/log.md` | `# Research Log` |
| `{pm_dir}/evidence/transcripts/index.md` | `# Transcripts` |
| `{pm_dir}/evidence/transcripts/log.md` | `# Transcripts Log` |
| `{pm_dir}/evidence/user-feedback/index.md` | `# User Feedback` |
| `{pm_dir}/evidence/user-feedback/log.md` | `# User Feedback Log` |
| `{pm_dir}/product/index.md` | `# Product` |

Default insight domains are `trends`, `competitors`, and `business`. Users can add custom domains later by creating `{pm_dir}/insights/<domain>/` with an `index.md`.

**Migration:** If `{pm_dir}/insights/product/` exists and `{pm_dir}/insights/trends/` does not, rename the directory (`mv {pm_dir}/insights/product {pm_dir}/insights/trends`). This preserves existing user data from the pre-1.0.52 naming convention.

### Step 2: Gitignore

Append these entries to the project root `.gitignore` if they are not already present:

```bash
.pm/
pm/*.local.md
```

### Step 3: Write Minimal Config

Write `.pm/config.json` with defaults that do not block the first workflow:

```json
{
  "config_schema": 2,
  "project_name": "My Product",
  "integrations": {
    "linear": { "enabled": false },
    "seo": { "provider": "none" }
  },
  "preferences": {}
}
```

Populate:

- `project_name` from the repo directory name by default
- `integrations.linear.enabled` as `false`
- `integrations.seo.provider` as `"none"`
- `preferences.ship.auto_merge` is **not set during bootstrap** — `/ship` will ask the user on first invocation and persist their choice. This ensures every user makes a conscious decision about merge behavior.

Only ask for a project name if the repo directory name is obviously generic or the user already gave you a better name.

Do **not** ask about Linear or Ahrefs during Bootstrap Mode. Those are deferred until a later workflow needs them.

### Step 3.5: Update CLAUDE.md

If `CLAUDE.md` exists at the project root, append a brief PM section so future sessions (even without the plugin) know the `pm/` directory is a structured knowledge base:

```markdown
## PM Knowledge Base

This project uses PM for product management. The `pm/` directory contains the structured knowledge base:
- `pm/insights/` — product, competitor, and business insights
- `pm/evidence/` — research, transcripts, and user feedback
- `pm/backlog/` — feature proposals and issues
- `pm/thinking/` — exploratory product thinking
- `pm/product/` — feature inventory and product capabilities
```

If `CLAUDE.md` already contains a `## PM Knowledge Base` section, skip this step. If `CLAUDE.md` does not exist, skip this step — do not create it just for this.

### Step 3.6: Customization (optional, mention only)

Do **not** create these files during bootstrap. Just mention they exist so the user knows how to customize later:

- `{pm_dir}/instructions.md` — shared team instructions (terminology, writing style, output format, competitors to track). Read by groom, research, think, ingest, strategy, and refresh skills.
- `{pm_dir}/instructions.local.md` — personal overrides (gitignored via `pm/*.local.md`). Takes precedence over shared instructions on conflict.
- `learnings.md` — auto-generated by dev retro. No need to create manually.

Include this as a single line in the bootstrap summary (Step 4): "Create `{pm_dir}/instructions.md` to customize how PM writes and what it tracks."

### Step 4: Summarize What Was Created

Before asking the user to choose a workflow, give a brief orientation so they understand the workspace:

> "PM is set up. Here's what was created:
> - `{pm_dir}/` — your knowledge base (insights, evidence, backlog, thinking)
> - `.pm/` — internal state (gitignored, you won't see this in commits)"

Keep this brief — no more than 3 lines. The goal is orientation, not a tutorial.

### Step 5: Choose The First Workflow

If the user already gave a clear starting intent, route directly.

If not, ask ONE question:

> "What do you want to do first?
> (a) Think through an idea — explore and pressure-test a product idea
> (b) Research the market — landscape overview of your space
> (c) Research competitors — profile specific alternatives
> (d) Research a specific topic — deep dive into any question
> (e) Groom a feature idea — scope and spec a feature for development
> (f) Import customer evidence — bring in transcripts, feedback, or data files"

### Step 6: Route Immediately

Routing rules:

- Thinking / brainstorming → if the idea is missing, ask for it, then invoke `pm:think`
- Market / landscape research → invoke `pm:research landscape`
- Competitor research → invoke `pm:research competitors`
- Specific topic research → if the topic is missing, ask for it, then invoke `pm:research <topic>`
- Grooming / feature scoping → if the idea is missing, ask for it, then invoke `pm:groom`
- File/folder path or evidence import request → invoke `pm:ingest`
- Just explore → show the session brief and stop. Do not route into a workflow.
- "explore", "look around", "just show me", "skip" → show session brief and stop

Tell the user briefly which lane you are taking, then hand off to that skill immediately.

## Resume Mode

### Goal

Give the user a fast session kickoff with update status, active-work detection, and one recommended next move.

### Flow

1. Refresh update status:

```bash
bash ${CLAUDE_PLUGIN_ROOT}/hooks/check-start.sh
```

This refreshes `.pm/.update_status` and may print a one-line update notice at session start.

2. Evidence detection:

Scan `{pm_dir}/evidence/user-feedback/` for unprocessed files and offer to route them to `pm:ingest`.

**Detection:**
- List all files in `{pm_dir}/evidence/user-feedback/` (non-recursive).
- Read `{pm_dir}/evidence/user-feedback/log.md`. Each non-heading, non-blank line contains a previously processed file path.
- Compute the difference: files present on disk but not listed in `log.md`.
- Filter out system files (`.DS_Store`, `.gitkeep`, `Thumbs.db`) — skip them entirely, do not show them.
- Filter out `index.md` and `log.md` themselves.
- If no unprocessed files remain, skip this step silently — produce no output.

**Name extraction (text-based files only):**

For each unprocessed file, attempt to extract a human-readable name:

| File type | Extraction rule |
|---|---|
| `.md` | First heading (`# ...`) |
| `.txt` | First non-empty line |
| `.html`, `.eml` | `Subject:` line if present, else `<title>` tag, else first non-empty line |
| Binary or unreadable files | Use the filename as the display name |

Read at most the first 5 lines of each file for extraction. If extraction fails or the file cannot be read, fall back to the filename.

**Display:**

Present a numbered list:

```text
Evidence drop zone — {N} new file(s):
1. "Pricing confusion on enterprise tier" (text, 4.8KB)
2. "user-interview-2026-04.md" (markdown, 12.1KB)
3. "feedback-export.csv" (csv, 89KB)
```

File type labels: use a human-friendly description based on extension (`.md` → "markdown", `.txt` → "text", `.csv` → "csv", `.eml` → "email", `.html` → "html", `.pdf` → "pdf", `.json` → "json"). For unknown extensions, use the extension itself. File size should use KB with one decimal for files under 1MB, MB with one decimal otherwise.

**User choice:**

Ask ONE question:

> "How do you want to handle these?
> (a) Ingest all
> (b) Pick specific files
> (c) Skip — leave for later"

Routing:
- **(a) Ingest all** → invoke `pm:ingest` with the full list of unprocessed file paths. After ingestion completes, append each file path with a timestamp to `{pm_dir}/evidence/user-feedback/log.md` in the format: `{relative_path_from_pm_dir} — {ISO 8601 timestamp}`.
- **(b) Pick specific files** → show the numbered list again and let the user select by number. Invoke `pm:ingest` with the selected files. After ingestion, append only the selected file paths to `log.md`.
- **(c) Skip** → continue with the normal flow. Files remain unprocessed for the next session.

After ingestion or skip, continue to step 3 (session brief).

3. Generate the canonical session brief:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/start-status.js --project-dir "$PWD" --format json --include-update
```

This script is the shared source of truth used by the runtime hook and should determine:

- whether PM is initialized
- whether an update is available
- whether active delivery or grooming work exists (see session locations below)
- the focus summary
- the backlog summary
- the recommended next move
- up to two concrete alternative moves

### Session file locations

When detecting active work, check the correct locations based on repo mode:

| Session type | Same-repo mode | Separate-repo mode |
|---|---|---|
| Groom sessions | `{pm_state_dir}/groom-sessions/*.md` | `{pm_state_dir}/groom-sessions/*.md` (PM repo) |
| Dev sessions | `{pm_state_dir}/dev-sessions/*.md` | `{source_dir}/.pm/dev-sessions/*.md` (source repo) |

In separate-repo mode, groom and dev sessions live in different repos. Always check both locations to detect all active work, regardless of which repo the user is standing in.

4. Pick the recommended next move using this priority:

- Any active delivery work (`dev`) → resume that work
- Active grooming work → resume `pm:groom`
- No durable work yet (no strategy, no insights, no evidence, no backlog) → go back to the first-workflow selector from Bootstrap Mode
- Missing strategy with insights or evidence already present → `pm:strategy`
- Stale insights or evidence → `pm:refresh`
- Idea-heavy backlog → `pm:groom`
- Otherwise → stay in Pulse Mode and let the user choose

5. Present the session brief in this format:

```text
PM ready.
Update: {update line}            # only if available
Focus: {active-session summary OR attention summary}
Backlog: {backlog line}          # if available
Next: {recommended next move}
Also: {alternative move}         # up to two lines, only if available
```

Rules:

- If there is no update available, omit the `Update:` line.
- Use `Focus:` for the most important thing right now. Prefer an active session over a generic freshness summary.
- If the shared status output includes alternatives, show them as short `Also:` lines after `Next:`.
- If this was auto-invoked at session start, do **not** force the user into a follow-up choice. Show the brief and continue with their actual request.
- If the user explicitly invoked `/pm:start` with no other request:
  - when active work exists, ask one question:
    - "How do you want to proceed?
      (a) Continue the recommended path
      (b) Do something else"
  - when no active work exists, ask one question:
    - "Want me to continue with the recommended next move, or choose one of the alternatives?"

## Pulse Mode

Use this when the project is initialized but there is no active work to resume.

The behavior is the same as Resume Mode (including evidence detection in step 3), except the recommendation should bias toward the next useful lane:

- `pm:strategy` when insights or evidence exist but strategy is missing
- `pm:refresh` when insights or evidence are stale
- `pm:groom` when backlog discovery is the best next move
- First-workflow selector when the workspace exists but is still effectively empty

When the user explicitly invoked `/pm:start`, Pulse Mode should still offer the same short follow-up choice:

- continue with `Next:`
- choose one of the `Also:` options

## Notes

- PM does not require integrations to be useful. Linear and Ahrefs are optional enhancements.
- Configure Linear or Ahrefs only when the chosen workflow needs them.
- Markdown backlog mode and web-search-only research are valid defaults.
- `pm:start` may route internally to other skills such as `pm:ingest`, `pm:research`, `pm:think`, `pm:groom`, or `pm:dev`.
- Do not force users to memorize those lanes during onboarding. `pm:start` should do the routing.
- The runtime hook and the explicit `pm:start` resume flow should use the same `scripts/start-status.js` output.
- `pm:start` is the public entry point for PM.
- PM operates entirely within the editor — no external server process required.
