---
name: setup
description: "Use when configuring the pm plugin for a new project, setting up integrations (Linear, Ahrefs), or bootstrapping the pm/ and .pm/ folder structures. Accepts an optional path to existing data for faster onboarding. Triggers on 'setup,' 'initialize,' 'bootstrap,' 'configure pm,' 'set up pm,' 'get started,' 'onboard.'"
---

# pm:setup

## Purpose
Configure integrations, bootstrap the knowledge base, and get to value fast — especially when the user already has existing research or evidence.

## Interaction Pacing

Ask ONE question at a time. Wait for the user's answer before asking the next. Do not bundle multiple questions in a single message. When you have follow-ups, ask the most important one first — the answer often makes the others unnecessary.

**Speed-up heuristic:** If the user's responses are rapid and minimal (e.g., "yes", "next", "skip", single-word answers), you may offer: "Want me to ask the remaining setup questions at once?" If they agree, present the remaining questions as a numbered list for batch response.

## When Required
Setup is advisory, not a hard gate. It is:
- **Recommended** on first use (SessionStart hook reminds if not configured)
- **Required** before skills that use integrations (research with SEO, groom with Linear)
- **NOT required** for `$pm-view` (read-only over committed files) or `$pm-research quick` (web search fallback)

Skills that need integrations check for config themselves and prompt setup if missing.

## Argument

`$pm-setup [path/to/existing-data]`

The path is optional. If provided, setup will import the data via `$pm-ingest` after configuration, so the user doesn't need to run two separate commands.

## Checklist
1. Create folder structure
2. Gitignore
3. Project name
4. Configure integrations
5. Write config
6. Verify SEO integration
7. Import existing data (if path provided)
8. Scan knowledge base and launch dashboard (if data exists)
9. Present gap-aware next steps

---


## Custom Instructions

Before starting work, check for user instructions:

1. If `pm/instructions.md` exists, read it — these are shared team instructions (terminology, writing style, output format, competitors to track).
2. If `pm/instructions.local.md` exists, read it — these are personal overrides that take precedence over shared instructions on conflict.
3. If neither file exists, proceed normally.

**Override hierarchy:** `pm/strategy.md` wins for strategic decisions (ICP, priorities, non-goals). Instructions win for format preferences (terminology, writing style, output structure). Instructions never override skill hard gates.

---

## Step 1: Create Folder Structure

Create the following directories. Do not create the .md files — those are written by their respective skills.

```bash
mkdir -p pm/competitors
mkdir -p pm/research
mkdir -p pm/backlog
mkdir -p .pm/imports
mkdir -p .pm/evidence
mkdir -p .pm/sessions
mkdir -p .pm/groom-sessions
```

This produces:
```
pm/                   # Committed knowledge base
  competitors/
  research/
  backlog/            # Used only if Linear is unavailable
.pm/                  # Gitignored runtime/config
  imports/            # $pm-ingest manifest + source tracking
  evidence/           # $pm-ingest normalized customer evidence
  sessions/           # Visual companion session state
```

## Step 2: Gitignore

Append these entries to the project root `.gitignore`. Create the file if it doesn't exist.

```bash
echo '.pm/' >> .gitignore
echo 'pm/*.local.md' >> .gitignore
```

Verify each line is not already present before appending to avoid duplicates. The `pm/*.local.md` pattern gitignores personal instruction files.

## Step 3: Project Name

Ask the user for their project name. This is displayed in the dashboard header and page titles.

> "What's the name of this project?"

Accept whatever they give — product name, company name, or repo name. Store it as `project_name` in the config.

If the user skips or says something like "just use the default," derive it from the parent directory name of `pm/`.

## Step 4: Integration Setup

### Linear
- First, ask the user whether they want to use Linear for issue tracking or prefer the local markdown backlog (`pm/backlog/`).
- If the user wants Linear: try listing teams via the Linear MCP tool. If available, show the team list, ask the user to select a team and optionally a project. Record the team ID and project ID. If the Linear MCP is unavailable, inform the user and fall back to the markdown backlog.
- If the user prefers local backlog: skip the Linear check entirely. Issues will be written to `pm/backlog/` as markdown files.

### SEO Provider
Present two options and ask the user to choose:

**Option A — Ahrefs MCP** (recommended, requires Ahrefs Lite plan or higher)
- Provides keyword volume, difficulty, SERP data, backlink metrics via the official Ahrefs MCP server.
- No API key needed — uses MCP authentication.
- After the user selects this option, check whether the Ahrefs MCP tools are available in the current client.
- Handle three states:
  1. **Not configured** — Tell the user to add/configure the Ahrefs MCP server for their client, then continue once it is available.
  2. **Configured but needs authentication** — Tell the user to complete the client's MCP authentication flow for Ahrefs, then continue.
  3. **Connected** — Ready to use. Proceed.

**Option B — None** (web search only)
- All qualitative research still works. No keyword volume or difficulty scores.
- Fully functional for landscape research, competitor analysis, and strategy.

## Step 5: Write Config

Write `.pm/config.json` with the values collected above. Use this schema:

```json
{
  "config_schema": 1,
  "project_name": "My Product",
  "integrations": {
    "linear": { "enabled": false },
    "seo": { "provider": "none" }
  },
  "preferences": {
    "visual_companion": true,
    "backlog_format": "markdown"
  }
}
```

Populate fields:
- `project_name`: the name the user provided in Step 3. Used in the dashboard header and page titles.
- `linear.enabled`: `true` if the user chose Linear and the MCP was reachable, `false` otherwise.
- `linear.team_id`: team ID selected by user (omit if disabled).
- `linear.project_id`: project ID selected by user (omit if not chosen).
- `seo.provider`: `"ahrefs-mcp"` or `"none"`. No credentials stored — Ahrefs authentication is handled by the MCP server.

## Step 6: Verify SEO Integration

**If `seo.provider` is `"ahrefs-mcp"`:**
- Verification was already done in Step 4 by checking the MCP server status shows `✓ Connected`. No further action needed.

**If `seo.provider` is `"none"`:** Skip this step.

## Step 7: Import Existing Data

**If a path argument was provided:**
- Invoke `$pm-ingest <path>` to import the data into the knowledge base.
- This normalizes evidence into `.pm/evidence/`, updates shared research in `pm/research/`, and handles deduplication.
- After ingest completes, continue to Step 8.

**If no path argument but `pm/` already has files** (e.g., cloned repo with committed research):
- Skip ingest. The data is already in place.
- Continue to Step 8.

**If no path and `pm/` is empty:**
- Skip to Step 9 (fresh start flow).

## Step 8: Launch Dashboard and Scan for Gaps

When the knowledge base has data (from ingest or pre-existing files), do two things:

### Launch the dashboard
Start `$pm-view` so the user can see their data immediately:

> "Opening the PM dashboard so you can see what's already in the knowledge base..."

Launch the dashboard server and give the user the URL.

### Scan for gaps
Read the `pm/` directory and classify what exists:

| Artifact | Check | Status |
|---|---|---|
| Landscape | `pm/landscape.md` exists | ✓ / ✗ |
| Strategy | `pm/strategy.md` exists | ✓ / ✗ |
| Competitors | Count dirs in `pm/competitors/` (exclude index.md, matrix.md) | N found / none |
| Competitor profiles | For each competitor, check which of the 5 files exist (profile, features, api, seo, sentiment) | Complete / partial / missing |
| Topic research | Count dirs in `pm/research/` | N topics / none |
| Customer evidence | Count files in `.pm/evidence/` | N records / none |
| Backlog | Count files in `pm/backlog/` | N issues / none |

Present a summary like:

```
Knowledge Base Status:
  ✓ Landscape overview
  ✓ Strategy document
  ✓ 5 competitors profiled (all complete)
  ✗ No SEO data for competitors (Ahrefs now configured — run /pm:refresh seo)
  ✗ No topic research
  ✓ 12 customer evidence records

Suggested next steps:
  1. /pm:refresh seo — backfill SEO data now that Ahrefs is configured
  2. /pm:research <topic> — investigate a specific question
```

### Gap-aware next step suggestions

Only suggest what's actually missing. Use this priority order:

1. **No landscape** → `/pm:research landscape`
2. **Landscape exists, no strategy** → `/pm:strategy`
3. **Strategy exists, no competitors** → `/pm:research competitors`
4. **Competitors exist but missing SEO data + Ahrefs configured** → `/pm:refresh seo`
5. **Competitors exist but incomplete profiles** → `/pm:refresh <slug>`
6. **Everything exists but stale** → `/pm:refresh`
7. **All research complete, no backlog** → `/pm:groom`
8. **No custom instructions** → Mention: "You can customize PM behavior by creating `pm/instructions.md` — think of it as the CLAUDE.md for your product. Add your team's terminology, writing style, competitors to track, and output preferences. For personal overrides, use `pm/instructions.local.md` (gitignored)."

Ask the user if they want to start the first suggested step now.

## Step 9: Fresh Start Flow

When `pm/` is empty and no import path was provided:

> "Setup complete. Your knowledge base is empty — let's build it.
> Recommended pipeline: `/pm:research landscape` → `/pm:strategy` → `/pm:research competitors` → `/pm:groom`
>
> Want to start with landscape research now?"

If yes, invoke `$pm-research landscape` immediately.

Do **not** launch `$pm-view` for an empty knowledge base — there's nothing to see yet.

---

## When User Has No Integrations

All skills work with web search alone:
- Research uses web search for qualitative landscape and competitor analysis.
- Strategy synthesizes whatever research exists in `pm/`.
- Groom writes to `pm/backlog/` as markdown issues.

SEO integration adds quantitative depth: keyword volume, difficulty scores, and SERP data. Linear integration adds issue tracking and sprint sync. Both are optional enhancements — not prerequisites.
