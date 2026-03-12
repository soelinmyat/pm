---
name: setup
description: "Use when configuring the pm plugin for a new project, setting up integrations (Linear, Ahrefs, DataForSEO), or bootstrapping the pm/ and .pm/ folder structures. Triggers automatically on first use of any pm skill."
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
mkdir -p .pm/sessions
```

This produces:
```
pm/                   # Committed knowledge base
  competitors/
  research/
  backlog/            # Used only if Linear is unavailable
.pm/                  # Gitignored runtime/config
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
- Try listing teams via the Linear MCP tool.
- If available: show the team list, ask the user to select a team and optionally a project. Record the team ID and project ID.
- If unavailable: explain the markdown backlog fallback. Issues will be written to `pm/backlog/` as markdown files instead of synced to Linear.

### SEO Provider
Present three options and ask the user to choose:

**Option A — Ahrefs** (full power, requires API plan)
- Provides keyword volume, difficulty, SERP data, backlink metrics.
- Ask for: Ahrefs API key.

**Option B — DataForSEO** (budget, $50 prepaid)
- Covers most keyword and SERP data at lower cost.
- Ask for: DataForSEO login (email) and password.

**Option C — None** (web search only)
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
- `linear.enabled`: `true` if Linear MCP was reachable, `false` otherwise.
- `linear.team_id`: team ID selected by user (omit if disabled).
- `linear.project_id`: project ID selected by user (omit if not chosen).
- `seo.provider`: `"ahrefs"`, `"dataforseo"`, or `"none"`.
- `seo.api_key`: Ahrefs key (omit for other providers).
- `seo.login` / `seo.password`: DataForSEO credentials (omit for other providers).

After writing, set restrictive permissions:
```bash
chmod 600 .pm/config.json
```

## Step 5: Verify SEO Credentials

Skip this step if `seo.provider` is `"none"`.

Run:
```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/seo-provider.js verify
```

The `verify` subcommand reads `.pm/config.json`, makes a minimal API call, and returns `{ "ok": true }` on success or `{ "error": "..." }` on failure.

If verification fails: show the error message, ask the user to re-enter credentials, rewrite `.pm/config.json` with the corrected values, and retry verification. Do not proceed until credentials verify or the user switches to `"none"`.

## Step 6: Bootstrap Flow

Tell the user:

> "Setup complete. Recommended next steps: /pm:research landscape -> /pm:strategy -> /pm:research competitors -> /pm:groom"

Ask if they want to start with landscape research now. If yes, invoke `/pm:research landscape` immediately.

---

## When User Has No Integrations

All skills work with web search alone:
- Research uses web search for qualitative landscape and competitor analysis.
- Strategy synthesizes whatever research exists in `pm/`.
- Groom writes to `pm/backlog/` as markdown issues.

SEO integration adds quantitative depth: keyword volume, difficulty scores, and SERP data. Linear integration adds issue tracking and sprint sync. Both are optional enhancements — not prerequisites.
