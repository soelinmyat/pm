---
name: setup
description: "Use when configuring the pm plugin for a new project, setting up integrations (Linear, Ahrefs), or bootstrapping the pm/ and .pm/ folder structures. Triggers automatically on first use of any pm skill."
---

# pm:setup

## Purpose
Configure integrations and bootstrap the knowledge base.

## When Required
Setup is advisory, not a hard gate. It is:
- **Recommended** on first use (SessionStart hook reminds if not configured)
- **Required** before skills that use integrations (research with SEO, groom with Linear)
- **NOT required** for /pm:view (read-only over committed files) or /pm:dig (web search fallback)

Skills that need integrations check for config themselves and prompt setup if missing.

## Checklist
1. Create folder structure
2. Configure integrations
3. Present bootstrap flow
4. Write config

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
```

This produces:
```
pm/                   # Committed knowledge base
  competitors/
  research/
  backlog/            # Used only if Linear is unavailable
.pm/                  # Gitignored runtime/config
  imports/            # /pm:ingest manifest + source tracking
  evidence/           # /pm:ingest normalized customer evidence
  sessions/           # Visual companion session state
```

## Step 2: Gitignore

Append `.pm/` to the project root `.gitignore`. Create the file if it doesn't exist.

```bash
echo '.pm/' >> .gitignore
```

Verify the line is not already present before appending to avoid duplicates.

## Step 3: Integration Setup

### Linear
- First, ask the user whether they want to use Linear for issue tracking or prefer the local markdown backlog (`pm/backlog/`).
- If the user wants Linear: try listing teams via the Linear MCP tool. If available, show the team list, ask the user to select a team and optionally a project. Record the team ID and project ID. If the Linear MCP is unavailable, inform the user and fall back to the markdown backlog.
- If the user prefers local backlog: skip the Linear check entirely. Issues will be written to `pm/backlog/` as markdown files.

### SEO Provider
Present two options and ask the user to choose:

**Option A — Ahrefs MCP** (recommended, requires Ahrefs Lite plan or higher)
- Provides keyword volume, difficulty, SERP data, backlink metrics via the official Ahrefs MCP server.
- No API key needed — uses MCP authentication.
- After the user selects this option, check the Ahrefs MCP server status by running:
  ```bash
  claude mcp list 2>&1 | grep ahrefs
  ```
- Handle three states:
  1. **Not configured** — Tell the user to add the Ahrefs MCP server:
     ```
     Run this command in a separate terminal, then come back:
     claude mcp add ahrefs https://api.ahrefs.com/mcp/mcp -t http
     ```
     After the user confirms, re-check the status.
  2. **Configured but needs authentication** (status shows `! Needs authentication`) — Tell the user:
     ```
     The Ahrefs MCP server is configured but not authenticated.
     Run /mcp in Claude Code, find "ahrefs" in the list, and complete the OAuth login.
     ```
     After the user confirms, re-check the status.
  3. **Connected** (status shows `✓ Connected`) — Ready to use. Proceed.

**Option B — None** (web search only)
- All qualitative research still works. No keyword volume or difficulty scores.
- Fully functional for landscape research, competitor analysis, and strategy.

## Step 4: Write Config

Write `.pm/config.json` with the values collected above. Use this schema:

```json
{
  "config_schema": 1,
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
- `linear.enabled`: `true` if the user chose Linear and the MCP was reachable, `false` otherwise.
- `linear.team_id`: team ID selected by user (omit if disabled).
- `linear.project_id`: project ID selected by user (omit if not chosen).
- `seo.provider`: `"ahrefs-mcp"` or `"none"`. No credentials stored — Ahrefs authentication is handled by the MCP server.

## Step 5: Verify SEO Integration

**If `seo.provider` is `"ahrefs-mcp"`:**
- Verification was already done in Step 3 by checking the MCP server status shows `✓ Connected`. No further action needed.

**If `seo.provider` is `"none"`:** Skip this step.

## Step 6: Bootstrap Flow

Tell the user:

> "Setup complete. Recommended next steps: /pm:ingest <path> (if you already have customer evidence) -> /pm:research landscape -> /pm:strategy -> /pm:research competitors -> /pm:groom"

Ask if they want to start with landscape research now. If yes, invoke `/pm:research landscape` immediately.

---

## When User Has No Integrations

All skills work with web search alone:
- Research uses web search for qualitative landscape and competitor analysis.
- Strategy synthesizes whatever research exists in `pm/`.
- Groom writes to `pm/backlog/` as markdown issues.

SEO integration adds quantitative depth: keyword volume, difficulty scores, and SERP data. Linear integration adds issue tracking and sprint sync. Both are optional enhancements — not prerequisites.
