---
name: start
description: "Lifecycle router for PM. For new repos, bootstrap PM and route into the best first workflow. For returning sessions, open the dashboard, surface update status, detect in-progress work, and recommend the next move. Triggers on session start (auto-invoked by using-pm), 'start,' 'initialize pm,' 'get started,' 'dashboard,' 'open dashboard,' 'show research,' 'show knowledge base,' 'open pm,' 'view pm,' 'view research.'"
---

# pm:start

## Purpose

`pm:start` is the main entry point for PM.

Use it to do one of three things:

1. **Bootstrap** PM in a repo that does not have a PM workspace yet
2. **Resume** active work in an initialized PM repo
3. **Open** the dashboard and get a fast session brief

`pm:start` should feel like "start PM here" — not "run a setup wizard."

## Telemetry (opt-in)

If analytics are enabled, read `${CLAUDE_PLUGIN_ROOT}/references/telemetry.md`.

Minimum coverage for `pm:start`:
- run start / run end for every invocation
- one step span for `detect-situation`
- one step span for the selected path: `bootstrap`, `resume`, `open`, or `pulse`

## Interaction Pacing

Ask ONE question at a time. Wait for the user's answer before asking the next.

## Detect The Situation

Check these signals in the current project root and the current user request:

- Does `pm/` exist?
- Does `.pm/config.json` exist?
- Is the user explicitly asking only to open the dashboard or view PM?
- Did the user pass a path argument after `/pm:start`?
- Is there active work in `.pm/groom-sessions/*.md` or `.pm/dev-sessions/*.md`?

Routing:

- If `pm/` or `.pm/config.json` is missing, use **Bootstrap Mode**
- If the project is initialized and the user explicitly asked only to open or view PM, use **Open Mode**
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
- "explore", "look around", "just show me", "skip" → show dashboard brief and stop

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
mkdir -p pm/insights/{product,competitors,business}
mkdir -p pm/evidence/{research,transcripts,user-feedback}
mkdir -p pm/backlog
mkdir -p pm/thinking
mkdir -p pm/product
mkdir -p .pm/imports
mkdir -p .pm/evidence
mkdir -p .pm/sessions
mkdir -p .pm/dev-sessions
```

Write each index and log file with a one-line heading (do not use `touch` — files should never be blank):

| File | Content |
|------|---------|
| `pm/insights/product/index.md` | `# Product Insights` |
| `pm/insights/product/log.md` | `# Product Insights Log` |
| `pm/insights/competitors/index.md` | `# Competitor Insights` |
| `pm/insights/competitors/log.md` | `# Competitor Insights Log` |
| `pm/insights/business/index.md` | `# Business Insights` |
| `pm/insights/business/log.md` | `# Business Insights Log` |
| `pm/evidence/index.md` | `# Evidence` |
| `pm/evidence/log.md` | `# Evidence Log` |
| `pm/evidence/research/index.md` | `# Research` |
| `pm/evidence/research/log.md` | `# Research Log` |
| `pm/evidence/transcripts/index.md` | `# Transcripts` |
| `pm/evidence/transcripts/log.md` | `# Transcripts Log` |
| `pm/evidence/user-feedback/index.md` | `# User Feedback` |
| `pm/evidence/user-feedback/log.md` | `# User Feedback Log` |
| `pm/product/index.md` | `# Product` |

Default insight domains are `product`, `competitors`, and `business`. Users can add custom domains later by creating `pm/insights/<domain>/` with an `index.md`.

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
  "config_schema": 1,
  "project_name": "My Product",
  "integrations": {
    "linear": { "enabled": false },
    "seo": { "provider": "none" }
  },
  "preferences": {
    "auto_launch": true
  }
}
```

Populate:

- `project_name` from the repo directory name by default
- `integrations.linear.enabled` as `false`
- `integrations.seo.provider` as `"none"`
- `preferences.auto_launch` as `true` — controls whether the dashboard server starts automatically on session start. Set to `false` to disable.
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

- `pm/instructions.md` — shared team instructions (terminology, writing style, output format, competitors to track). Read by groom, research, think, ingest, strategy, and refresh skills.
- `pm/instructions.local.md` — personal overrides (gitignored via `pm/*.local.md`). Takes precedence over shared instructions on conflict.
- `learnings.md` — auto-generated by dev retro. No need to create manually.

Include this as a single line in the bootstrap summary (Step 4): "Create `pm/instructions.md` to customize how PM writes and what it tracks."

### Step 4: Summarize What Was Created

Before asking the user to choose a workflow, give a brief orientation so they understand the workspace:

> "PM is set up. Here's what was created:
> - `pm/` — your knowledge base (insights, evidence, backlog, thinking)
> - `.pm/` — internal state (gitignored, you won't see this in commits)
> - Dashboard: {url}"

If the dashboard URL is not available, omit the dashboard line.

Keep this brief — no more than 4 lines. The goal is orientation, not a tutorial.

### Step 5: Choose The First Workflow

If the user already gave a clear starting intent, route directly.

If not, ask ONE question:

> "What do you want to do first?
> (a) Think through an idea — explore and pressure-test a product idea
> (b) Research the market — landscape overview of your space
> (c) Research competitors — profile specific alternatives
> (d) Research a specific topic — deep dive into any question
> (e) Groom a feature idea — scope and spec a feature for development
> (f) Import customer evidence — bring in transcripts, feedback, or data files
> (g) Just explore — look around the dashboard first"

### Step 6: Route Immediately

Routing rules:

- Thinking / brainstorming → if the idea is missing, ask for it, then invoke `pm:think`
- Market / landscape research → invoke `pm:research landscape`
- Competitor research → invoke `pm:research competitors`
- Specific topic research → if the topic is missing, ask for it, then invoke `pm:research <topic>`
- Grooming / feature scoping → if the idea is missing, ask for it, then invoke `pm:groom`
- File/folder path or evidence import request → invoke `pm:ingest`
- Just explore → show the dashboard brief and stop. Do not route into a workflow.

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

2. If the repo is initialized, launch the dashboard artifact view:

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/start-server.sh --project-dir "$PWD" --mode dashboard
```

Capture the `url` if one is returned.

3. Generate the canonical session brief:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/start-status.js --project-dir "$PWD" --format json --include-update
```

This script is the shared source of truth used by the runtime hook and should determine:

- whether PM is initialized
- whether an update is available
- whether active delivery or grooming work exists
- the focus summary
- the backlog summary
- the recommended next move
- up to two concrete alternative moves

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
Dashboard: {url}
Update: {update line}            # only if available
Focus: {active-session summary OR attention summary}
Backlog: {backlog line}          # if available
Next: {recommended next move}
Also: {alternative move}         # up to two lines, only if available
```

Rules:

- If the dashboard launch returns nothing, skip the dashboard line silently.
- Treat the dashboard as a read-only artifact surface unless the project explicitly enables interactive dashboard input.
- If there is no update available, omit the `Update:` line.
- Use `Focus:` for the most important thing right now. Prefer an active session over a generic freshness summary.
- If the shared status output includes alternatives, show them as short `Also:` lines after `Next:`.
- If this was auto-invoked at session start, do **not** force the user into a follow-up choice. Show the brief and continue with their actual request.
- If the user explicitly invoked `/pm:start` with no other request:
  - when active work exists, ask one question:
    - "How do you want to proceed?
      (a) Continue the recommended path
      (b) Open the dashboard only
      (c) Do something else"
  - when no active work exists, ask one question:
    - "Want me to continue with the recommended next move, choose one of the alternatives, or just leave you at the dashboard?"

## Open Mode

When the user explicitly asks to open the dashboard, show PM, or view research:

- If the project is initialized, run the same update refresh + dashboard launch + shared status brief as Resume Mode.
- Do **not** route into another workflow unless the user asks.
- If the project is not initialized, use Bootstrap Mode instead.

## Pulse Mode

Use this when the project is initialized but there is no active work to resume and the user did not ask for dashboard-only behavior.

The behavior is the same as Resume Mode, except the recommendation should bias toward the next useful lane:

- `pm:strategy` when insights or evidence exist but strategy is missing
- `pm:refresh` when insights or evidence are stale
- `pm:groom` when backlog discovery is the best next move
- First-workflow selector when the workspace exists but is still effectively empty

When the user explicitly invoked `/pm:start`, Pulse Mode should still offer the same short follow-up choice:

- continue with `Next:`
- choose one of the `Also:` options
- or just stay on the dashboard

## Notes

- PM does not require integrations to be useful. Linear and Ahrefs are optional enhancements.
- Configure Linear or Ahrefs only when the chosen workflow needs them.
- Markdown backlog mode and web-search-only research are valid defaults.
- `pm:start` may route internally to other skills such as `pm:ingest`, `pm:research`, `pm:think`, `pm:groom`, or `pm:dev`.
- Do not force users to memorize those lanes during onboarding. `pm:start` should do the routing.
- The runtime hook and the explicit `pm:start` resume flow should use the same `scripts/start-status.js` output.
- `pm:start` is the public entry point for PM.
