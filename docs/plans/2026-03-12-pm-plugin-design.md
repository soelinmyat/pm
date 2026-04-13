# PM Plugin: Product Discovery & Competitive Intelligence

**Date:** 2026-03-12
**Status:** Approved
**Author:** Soe Lin Myat

## Overview

A Claude Code plugin that gives Product Managers a structured, AI-powered workflow for product discovery, competitive intelligence, and feature grooming. Sits upstream of superpowers: PM produces well-researched, validated, scoped work. Superpowers implements it.

**Name:** `pm`
**License:** MIT
**Distribution:** Public GitHub repo, installable via Claude Code plugin marketplace
**Cross-platform:** Claude Code, Cursor, Codex, OpenCode, Gemini CLI. Skills are platform-agnostic. Each platform gets its own manifest, bootstrap, and installation guide (see Cross-Platform Support section).

## Problem

PMs do product discovery and competitive research manually: scattered notes, ad-hoc web searches, unstructured competitor tracking, feature ideas that skip validation. Research doesn't compound. Strategy alignment is checked inconsistently. The gap between "idea" and "well-groomed issue" is filled with tribal knowledge and gut feel.

No plugin in the Claude Code ecosystem addresses product work. Superpowers owns dev workflow. Nothing owns the PM workflow upstream of it.

## Core Principles

1. **Research compounds.** Every session builds on prior work. The knowledge base grows over time.
2. **Strategy is a hard gate.** Features that don't align with strategy get flagged before anyone writes code.
3. **Deep, not surface.** API docs, support pages, review sentiment, SEO data. Not just "they have feature X."
4. **Composable skills.** Use just research. Use just strategy. Use the full groom lifecycle. No all-or-nothing.
5. **Graceful degradation.** Works with zero integrations (web search only), gets more powerful with Ahrefs/DataForSEO and Linear.

## Skills Architecture

Five composable skills plus a dashboard command. Each independently useful. `pm:groom` orchestrates the others.

```
pm:setup          Configure integrations + bootstrap folder structure
pm:strategy       Create/maintain product strategy doc
pm:research       Competitive intelligence engine (landscape, competitors, topics)
pm:groom          Orchestrator: strategy -> research -> scope -> backlog
pm:dig            Quick inline research for mid-work decisions
pm:view           Browse the knowledge base in your browser (read-only dashboard)
```

### Composition Model

```
pm:setup (first-run gate)
    |
    +-- pm:research (standalone, three modes)
    |       +-- landscape: industry overview, market keywords, key players (pre-strategy)
    |       +-- competitors: deep profiling, features, API, reviews (post-strategy)
    |       +-- {topic}: targeted topic investigation (anytime)
    |
    +-- pm:strategy (standalone, informed by landscape)
    |
    +-- pm:groom (orchestrator)
    |       +-- checks strategy alignment
    |       +-- invokes research as needed
    |       +-- scope & validate (10x filter)
    |       +-- visual companion for decisions
    |       +-- optionally creates backlog items
    |
    +-- pm:dig (lightweight, no state)
    |
    +-- pm:view (browse knowledge base in browser)
```

### Recommended Bootstrap Flow

When starting from scratch in a new project:

```
pm:setup → pm:research landscape → pm:strategy → pm:research competitors → pm:groom
```

Each artifact builds on the previous:
- **Landscape** informs strategy (who's in the space, market segments, opportunities)
- **Strategy** focuses competitor research (ICP, positioning, non-goals filter what matters)
- **Competitor research** feeds grooming (baseline to differentiate against)

## Folder Structure

Two directories. `pm/` is the visible, durable knowledge base (committed to git). `.pm/` is hidden runtime/config (gitignored).

```
pm/                                  # VISIBLE - durable knowledge base (committed)
+-- landscape.md                     # industry overview (foundational, pre-strategy)
+-- strategy.md                      # product strategy doc (informed by landscape)
+-- competitors/
|   +-- index.md                     # official competitor list + positioning map
|   +-- {competitor-slug}/
|       +-- profile.md               # overview, pricing, target market, strengths/weaknesses
|       +-- features.md              # feature inventory (marketing + support + API docs)
|       +-- api.md                   # API surface, data model, integrations (if public)
|       +-- seo.md                   # keyword data, traffic, top pages, backlinks
|       +-- sentiment.md             # G2, Capterra, Reddit, forum reviews
+-- research/
|   +-- index.md                     # topic index with status + last updated
|   +-- {topic-slug}/
|       +-- findings.md              # findings, sources, dates, conclusions
+-- backlog/                         # only created if no Linear
    +-- index.md                     # issue index with status
    +-- {issue-slug}.md              # individual issue with acceptance criteria

.pm/                                 # HIDDEN - runtime & config (gitignored)
+-- config.json                      # integrations, preferences, API keys
+-- .groom-state.md                  # resumable groom session state
+-- sessions/                        # visual companion session files
    +-- {session-id}/
        +-- *.html
```

### Conventions

- `index.md` over `README.md` (indexes, not GitHub landing pages)
- Slugified names everywhere (`cleaning-software-market/`, not `Cleaning Software Market/`)
- `pm/` is committed to git (the knowledge base is shared with the team)
- `.pm/` is fully gitignored (API keys, ephemeral sessions, state files)
- Gitignore mechanism: append `.pm/` to project root `.gitignore`. Create it if it doesn't exist.

**Content file frontmatter (YAML):**
```yaml
---
type: competitor-profile  # landscape | strategy | competitor-profile | competitor-features | competitor-api | competitor-seo | competitor-sentiment | research-findings | backlog-issue
created: 2026-03-12
updated: 2026-03-12
sources:
  - url: https://example.com/pricing
    accessed: 2026-03-12
    type: primary
  - url: https://g2.com/products/example/reviews
    accessed: 2026-03-12
    type: review
---
```

## Skill Specifications

### pm:setup

**Purpose:** Configure integrations and bootstrap the `pm/` and `.pm/` folder structures.

**Triggers:**
- Recommended on first use (SessionStart hook reminds if not configured)
- Required before skills that use integrations (research with SEO, groom with Linear)
- NOT required for `/pm:view` (read-only over committed files) or `/pm:dig` (web search fallback)
- Manually via `/pm:setup` anytime to add/change integrations

**Flow:**
1. Create `pm/` (knowledge base) and `.pm/` (runtime/config) folder structures
2. Add `.pm/` to `.gitignore` (entire hidden directory is runtime/config)
3. Walk through integrations:
   - **Linear:** Detect Linear MCP availability. If present, select team/project. If absent, explain markdown backlog fallback.
   - **SEO provider:** Choose between Ahrefs (full power), DataForSEO (budget, $50 prepaid), or None (web search only).
   - Verify API key / connection for chosen provider.
   - Auto-install dependencies if needed (see SEO Integration section).
4. Present the recommended bootstrap flow: `/pm:research landscape` first, then `/pm:strategy`. Ask if user wants to start with landscape research now, or skip and come back later.
5. Write preferences to `.pm/config.json`

**Config file structure (JSON, not YAML):**

JSON eliminates the need for a custom YAML parser while maintaining zero dependencies (`JSON.parse` is built-in).

```json
{
  "config_schema": 1,
  "integrations": {
    "linear": {
      "enabled": true,
      "team_id": "TEAM-123",
      "project_id": "PROJECT-456"
    },
    "seo": {
      "provider": "ahrefs",
      "api_key": "ak_..."
    }
  },
  "preferences": {
    "visual_companion": true,
    "backlog_format": "linear"
  }
}
```

Only the fields relevant to the chosen provider are populated. Ahrefs uses `api_key`. DataForSEO uses `login` + `password`. Provider field is one of: `"ahrefs"`, `"dataforseo"`, `"none"`.

### pm:strategy

**Purpose:** Create and maintain the product strategy document that all other skills reference for alignment.

**Triggers:**
- `/pm:strategy` (standalone)
- Invoked by `pm:groom` when no strategy exists

**Flow:**
1. Check for `pm/landscape.md`. If missing, recommend running `/pm:research landscape` first (not a hard gate, but the strategy interview is more productive with landscape context)
2. Search for existing strategy docs in the project (`STRATEGY.md`, `PRODUCT.md`, `PRD.md`, files in `docs/product/`, `docs/strategy/`)
3. If found: ask user if they want to adopt/import it or create a pm-native one
4. If creating: adaptive interview (informed by landscape data when available)
   - Starts with essentials: ICP, core value prop, current phase, non-goals
   - References landscape data when available (market segments, key players, keyword clusters inform the conversation)
   - Goes as deep as user wants: competitive positioning, market sizing, go-to-market, pricing philosophy, success metrics, risk factors
   - The interview follows the user's energy. Quick pass or deep dive.
5. Write `pm/strategy.md`
6. Visual companion for strategy canvas if user opts in (positioning map, competitive landscape visualization)

**Strategy doc sections:**
- Product identity (what, who, why)
- ICP and segmentation (who exactly, what job-to-be-done)
- Core value prop and differentiation (why you, not them)
- Competitive positioning (where you sit in the market)
- Current phase and priorities (what matters now)
- Explicit non-goals (what you are NOT doing, and why)
- Success metrics (how you measure progress)

**Update flow:** `/pm:strategy` on an existing doc opens it for targeted updates. Not a full re-interview. User says what changed, strategy doc updates.

### pm:research

**Purpose:** Competitive intelligence engine. Builds a compounding knowledge base about competitors, market, and topics.

**Triggers:**
- `/pm:research landscape` - industry overview (pre-strategy)
- `/pm:research competitors` - deep competitor profiling (post-strategy)
- `/pm:research {topic}` - targeted topic investigation (anytime)
- Invoked by `pm:groom` for targeted gap-filling during feature grooming
- Invoked by `pm:strategy` when no landscape exists (recommends running landscape first)

**Three modes:**

#### Landscape Research (`/pm:research landscape`)

Lightweight industry overview. The foundational artifact that informs strategy. Run this first in a new project.

1. Use SEO provider for keyword analysis in the product's space (top keywords, volume, clusters)
2. Web search to identify the overall market: who are the players, what segments exist, what trends are emerging
3. Present findings to user for validation
4. Write `pm/landscape.md`

**Landscape artifact structure:**
```yaml
---
type: landscape
created: 2026-03-12
updated: 2026-03-12
sources:
  - url: https://...
    accessed: 2026-03-12
---
```

**Sections:**
- **Market overview:** What the space is, who it serves, market size signals (Ahrefs keyword volume, web research)
- **Key players:** Table of companies with positioning, size signal, and notes. This becomes the candidate list for competitor confirmation later.
- **Keyword landscape:** Top keywords defining the space (volume, difficulty), keyword clusters/sub-categories, content gaps
- **Market segments:** How the market segments (company size, vertical, use case), which segments are crowded vs underserved
- **Initial observations:** Where opportunities exist, what's table stakes vs differentiating

**Update flow:** `/pm:research landscape` on an existing landscape.md refreshes data and appends new findings. Tracks what changed since last update.

#### Competitor Research (`/pm:research competitors`)

**Phase 1: Discover**
- If `pm/landscape.md` exists, use its Key Players table as the starting candidate list
- If no landscape, use SEO provider + web search to identify players (and recommend running `/pm:research landscape` first)
- Present candidate list to user
- User confirms which are actual competitors
- Save confirmed list to `pm/competitors/index.md`

**Phase 2: Profile (per confirmed competitor)**

For each competitor, build a deep, structured profile:

| File | Sources | Data |
|------|---------|------|
| `profile.md` | Marketing site, about page, press | Overview, founding, target market, pricing model, tiers, free plan, positioning, messaging, strengths, weaknesses |
| `features.md` | Marketing pages, support docs, help center, changelogs | Feature inventory (not marketing claims, actual capabilities). Categorized by domain. What they support, what they don't. |
| `api.md` | API documentation, developer docs | Endpoints, data model, authentication, webhooks, integrations, SDKs. Reveals true product architecture. |
| `seo.md` | Ahrefs/DataForSEO | Top ranking keywords, organic traffic estimates, top pages, backlink profile, content strategy signals |
| `sentiment.md` | G2, Capterra, Reddit, forums, app stores | Review themes, common complaints, praised features, NPS signals, support quality perception |

**Phase 3: Synthesize**
- Generate comparison matrix across competitors
- Identify market gaps and opportunities
- Visual companion: interactive competitor comparison table

**Ongoing:** Each subsequent `/pm:research competitors` updates existing profiles rather than starting fresh. New competitors can be added. The knowledge base grows.

#### Topic Research (`/pm:research {topic}`)

1. Check existing `pm/research/{topic}/` first
2. Check `pm/competitors/` for relevant competitor data
3. Web search + SEO data for gaps
4. Save durable findings with sources, dates, and conclusions
5. Present summary with recommendations
6. Update `pm/research/index.md`

#### Research Rules

- Always check existing knowledge before web search (don't duplicate work)
- Save findings with sources and access dates (research decays, dates matter)
- Update existing files, don't create duplicates
- No artificial limit on search depth. Go as deep as the question requires.

### pm:groom

**Purpose:** Orchestrate the full product discovery lifecycle. Turn a vague idea into well-researched, validated, scoped work items.

**Triggers:** `/pm:groom` or `/pm:groom {feature-idea}`

**Lifecycle:** `intake -> strategy check -> research -> scope -> groom -> link`

**Phase 1: Intake**
- Understand the idea. What problem? For whom? Why now?
- Identify whether this is discovery, validation, or decomposition work
- Check `pm/research/` for existing context on the topic

**Phase 2: Strategy Check**
- Read `pm/strategy.md`
- Does this align with current priorities?
- Does it violate any explicit non-goals?
- Call out misalignment explicitly. Don't silently proceed.

**Phase 3: Research**
- Invoke `pm:research` for targeted investigation
- How do confirmed competitors handle this feature?
- What do users expect (review sentiment, forum discussions)?
- What's the market signal (keyword volume, search trends)?
- Technical feasibility considerations

**Phase 4: Scope**
- Define in-scope and out-of-scope explicitly
- Apply 10x filter: is this meaningfully better than what exists, or just incremental?
- Compare against competitor baseline
- Visual companion: scope prioritization grid (impact/effort with interactive selection)

**Phase 5: Groom**
- Draft structured issues (parent + child issues)
- Each issue includes:
  - Clear outcome statement
  - Acceptance criteria
  - Links to research findings
  - Competitor context (how others handle this)
- Present draft set to user for approval before creating

**Phase 6: Link (optional)**
- If Linear configured: create issues in Linear
- If no Linear: write to `pm/backlog/`
- Link issues back to research artifacts
- Update `pm/research/index.md` with issue references

**State management:**
- `.pm/.groom-state.md` for resumable sessions
- Tracks: current phase, topic, research location, strategy check result, confirmed scope, issue status
- Cold resume reads state file and picks up where it left off
- Cleaned up after issues are created and linked
- Only one groom session active at a time (single state file). Start a new groom to replace the previous session.

### pm:dig

**Purpose:** Quick inline research for mid-work decisions. No state, no issues. Think, research, recommend.

**Triggers:** `/pm:dig {question}`

**Flow:**
1. **Frame** the question in one sentence. What are the options? What are the constraints?
2. **Check strategy** alignment (`pm/strategy.md`)
3. **Check existing knowledge** (`pm/research/`, `pm/competitors/`)
4. **Research gaps** via web search + SEO data
5. **Save significant discoveries** to knowledge base (don't lose insights)
6. **Recommend:** option, reasoning, why not alternatives, risk/tradeoff

**Rules:**
- No state file. Ephemeral.
- No issue creation. If the answer implies new work, note it but suggest deferring to `/pm:groom`.
- Save valuable research. Quick workflow, but knowledge still compounds.

## Visual Companion & Dashboard

The plugin's local server has two modes, both built on the same zero-dep Node.js server (adapted from superpowers, MIT licensed).

### Mode 1: Interactive Companion (during skills)

Used during strategy, research, and grooming sessions for interactive visual content.

**When to use:**
- Competitor comparison matrices (feature grids, pricing tables)
- Strategy canvas (positioning maps, value prop visualization)
- Research dashboards (keyword data, traffic insights, competitor overview)
- Scope prioritization (impact/effort grids with interactive selection)
- Issue previews before creating in Linear

**How it works:**
1. Offered once at the start of a visual-heavy session (strategy, research, groom)
2. User opts in by opening a local URL
3. Plugin decides per-question whether browser or terminal is appropriate
4. HTML fragments written to `.pm/sessions/`, auto-wrapped in PM-branded template
5. WebSocket for live updates and user selections

### Mode 2: Knowledge Base Dashboard (`/pm:view`)

Read-only browser view of the entire `pm/` knowledge base. One URL, full picture of your product intelligence.

**Command:** `/pm:view` starts the server in dashboard mode and prints the URL.

**Routes:**
```
http://localhost:{port}/

/                        Home dashboard: knowledge base health overview
/landscape               Rendered landscape.md
/strategy                Rendered strategy.md
/competitors             Competitor card grid
/competitors/{slug}      Competitor detail (tabbed: profile, features, API, SEO, sentiment)
/research                Research topic list
/research/{topic}        Topic findings
/backlog                 Kanban board (columns by status)
/backlog/{slug}          Individual issue detail
```

**View designs per section:**

| Section | Layout | Content |
|---------|--------|---------|
| **Home** | Status dashboard | Counts (competitors profiled, research topics, backlog by status), last updated dates, knowledge base completeness. Quick health check. |
| **Landscape** | Single page | Rendered markdown with keyword data tables and market segment breakdown. |
| **Strategy** | Single page | Rendered markdown with visual callouts for ICP, non-goals, current phase, positioning. |
| **Competitors** | Card grid | One card per competitor: positioning summary, feature count, last updated. Click into tabbed detail view. |
| **Research** | Topic list | Index with topic name, status badge, last updated. Click into rendered findings. |
| **Backlog** | Kanban board | Columns by status (open, in-progress, done). Cards show title, priority badge, parent/child hierarchy. Read-only (no drag-and-drop). |

**Implementation:**
- Same `scripts/server.js` with a `--mode dashboard` flag
- Reads `pm/` directory, parses markdown + YAML frontmatter, renders as HTML
- Groups backlog issues by `status` field for kanban columns
- Clean CSS (PM-branded, same design language as companion templates)
- Auto-refreshes when files change (WebSocket reload, same as companion mode)
- Pure HTML/CSS/vanilla JS. No framework dependencies.
- Read-only. No editing from the browser. Markdown is the source of truth.
- Navigation bar across all pages for quick section switching

**Why this matters:** The "no Linear" experience becomes genuinely good. Instead of navigating a folder of markdown files, PMs get a browsable dashboard with kanban, card grids, and rendered research. Even users WITH Linear benefit: competitor profiles, research, and strategy are more readable here than in raw markdown.

### Server Implementation

The pm plugin bundles its own copy of the zero-dep visual companion server. Uses random high port (49152-65535) to avoid conflicts if superpowers is also running. Auto-exits after 30 min of inactivity or when parent process dies.

### PM-Specific Templates

| Template | Use Case |
|----------|----------|
| `competitor-matrix.html` | Side-by-side feature/pricing comparison grid |
| `strategy-canvas.html` | Positioning map, value prop, ICP visualization |
| `research-dashboard.html` | Keyword data, traffic charts, market overview |
| `scope-grid.html` | Impact/effort prioritization with interactive selection |
| `issue-preview.html` | Structured issue cards before Linear creation |

## Integration Architecture

### SEO Provider (Ahrefs or DataForSEO)

Uses `scripts/seo-provider.js` (see SEO Integration Mechanism section below). Both providers are accessed via HTTP REST APIs through the zero-dependency Node.js helper.

**Ahrefs:** Full power. Keywords Explorer, Site Explorer, Content Explorer. Requires Ahrefs API plan.

**DataForSEO:** Budget alternative ($50 prepaid, no subscription). SERP API, Keywords Data API, Backlinks API.

**None:** Web search only. No quantitative SEO data. Research skill still functions for qualitative competitor analysis.

### Linear (Issue Tracker)

- Detected via Linear MCP availability
- Used in `pm:groom` link phase and `pm:setup`
- If unavailable: `pm/backlog/` markdown files with structured frontmatter
- Same issue format regardless of backend (title, description, acceptance criteria, labels, parent/child relationships)

### Fallback Behavior

| Integration | Available | Unavailable |
|-------------|-----------|-------------|
| SEO provider | Keyword data, traffic estimates, backlink analysis | Web search only, qualitative research |
| Linear | Issues created in Linear with full metadata | Issues written to `pm/backlog/` as markdown |
| Visual companion | Browser-based comparisons and grids | Text-based tables and recommendations in terminal |

## Plugin Manifest

```json
{
  "name": "pm",
  "displayName": "PM",
  "description": "Product discovery, competitive intelligence, and feature grooming for Product Managers",
  "version": "1.0.0",
  "author": { "name": "Soe Lin Myat" },
  "homepage": "https://github.com/soelinmyat/pm",
  "repository": "https://github.com/soelinmyat/pm",
  "license": "MIT",
  "keywords": ["product-management", "competitive-intelligence", "grooming", "research", "discovery"],
  "skills": "./skills/",
  "agents": "./agents/",
  "commands": "./commands/",
  "hooks": "./hooks/hooks.json"
}
```

## SKILL.md Frontmatter

Each skill needs precise frontmatter for Claude Code's skill-matching system.

### pm:setup
```yaml
---
name: setup
description: "Use when configuring the pm plugin for a new project, setting up integrations (Linear, Ahrefs, DataForSEO), or bootstrapping the pm/ and .pm/ folder structures. Triggers automatically on first use of any pm skill."
---
```

### pm:strategy
```yaml
---
name: strategy
description: "Use when creating or maintaining a product strategy document. Covers ICP, value prop, competitive positioning, priorities, non-goals. Triggers on 'strategy,' 'positioning,' 'ICP,' 'non-goals,' 'product direction.'"
---
```

### pm:research
```yaml
---
name: research
description: "Use when doing industry landscape analysis, competitive intelligence, competitor profiling, market research, keyword analysis, or building the product knowledge base. Three modes: landscape (industry overview, pre-strategy), competitors (deep profiling, post-strategy), topic (targeted investigation). Triggers on 'research,' 'landscape,' 'competitor,' 'competitive analysis,' 'market research,' 'keyword research,' 'industry overview.'"
---
```

### pm:groom
```yaml
---
name: groom
description: "Use when doing product discovery, feature grooming, or turning a product idea into structured issues. Orchestrates strategy check, research, scoping, and issue creation. Triggers on 'groom,' 'feature idea,' 'product discovery,' 'scope this,' 'create issues for.'"
---
```

### pm:dig
```yaml
---
name: dig
description: "Use for quick inline product research during other work. Lightweight alternative to pm:groom. No state, no issues. Frame question, check strategy, research, recommend. Triggers on 'quick question about,' 'should we,' 'how do competitors handle.'"
---
```

## Hooks Specification

### First-Run Detection

Uses `SessionStart` hook (same pattern as superpowers). The hook script checks for `.pm/config.json` and injects a setup reminder into the session context if missing.

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume|clear|compact",
        "hooks": [
          {
            "type": "command",
            "command": "'${CLAUDE_PLUGIN_ROOT}/hooks/check-setup.sh'",
            "async": false
          }
        ]
      }
    ]
  }
}
```

**`hooks/check-setup.sh`** behavior:
1. Check if `.pm/config.json` exists in the current project
2. If it exists, exit with no output (already set up)
3. If missing, write to stdout as plain text (SessionStart hooks inject stdout into session context as `additionalContext`):

```
PM plugin is not configured for this project. Run /pm:setup to bootstrap
the knowledge base and configure integrations (Linear, Ahrefs/DataForSEO).
Skip this if you only need /pm:view (read-only over committed files).
```

The message is advisory, not a hard gate. Skills that need integrations (research with SEO data, groom with Linear) check for config themselves and prompt setup if missing. `/pm:view` works without setup as long as `pm/` exists.

## Commands Role

Commands in `commands/` are slash-command entry points. Each is a thin wrapper that invokes the corresponding skill.

**Example: `commands/groom.md`**
```markdown
---
description: "Product discovery and feature grooming. Orchestrates strategy, research, scoping, and issue creation."
args:
  - name: idea
    description: "The feature idea or topic to groom"
    required: false
---

Invoke the pm:groom skill and follow it exactly as presented to you.
```

**Example: `commands/view.md`**
```markdown
---
description: "Open the PM knowledge base dashboard in your browser. Browse landscape, strategy, competitors, research, and backlog."
---

Start the PM dashboard server by running: node ${CLAUDE_PLUGIN_ROOT}/scripts/server.js --mode dashboard --dir pm/
Print the URL for the user to open. The server auto-exits after 30 minutes of inactivity.
```

All six commands follow this pattern: frontmatter with description + optional args, body tells the agent to invoke the matching skill.

## Researcher Agent

### `agents/researcher.md`

```yaml
---
name: researcher
description: |
  Use this agent for parallel competitor profiling. Dispatched by pm:research
  to investigate a single competitor in depth. Each agent instance profiles
  one competitor independently, enabling parallel research across multiple
  competitors simultaneously.
model: inherit
---
```

**Purpose:** When `pm:research competitors` needs to profile 3+ competitors, dispatching one researcher agent per competitor enables parallel investigation instead of sequential.

**System prompt (summary):**
- You are a competitive intelligence researcher
- You are profiling a single competitor: {competitor_name}
- Your domain context: {product_space}
- Investigate: marketing site, pricing, support docs, API docs, reviews, changelogs
- Write findings to the structured files in `pm/competitors/{slug}/`
- Do NOT write to `pm/competitors/index.md` (the parent research skill owns the index)
- Follow the frontmatter convention for all files
- Include sources and access dates for everything
- Be thorough. Support pages and help centers contain the real feature depth.
- If SEO API calls fail (rate limit, network error), log the error in seo.md and continue

**Required tools:** WebSearch, WebFetch, Read, Write, Bash (for seo-provider.js). Does not need Edit, Glob, or Grep.

**Dispatch conditions:** Used when 2+ competitors need profiling. Single competitor profiles are done inline by the research skill.

**Platform fallback:** On platforms without subagent support (Gemini CLI, OpenCode), the research skill profiles competitors sequentially inline instead of dispatching agents. The skill detects this by attempting the Agent tool and falling back on failure.

## SEO Integration Mechanism

Both Ahrefs and DataForSEO are HTTP REST APIs. The plugin ships Node.js helper scripts (consistent with the visual companion server) that handle API calls.

### `scripts/seo-provider.js`

Zero-dependency Node.js module (uses built-in `https` module). Exports:

```javascript
// Provider-agnostic interface
getKeywords(domain, options)    // -> { keywords: [{ keyword, volume, difficulty, position }] }
getTraffic(domain)              // -> { organic_traffic, top_pages: [{ url, traffic, keyword }] }
getBacklinks(domain)            // -> { total, referring_domains, top_backlinks: [...] }
getCompetitors(keywords)        // -> { domains: [{ domain, overlap_score, traffic }] }
```

**Ahrefs adapter:** Calls Ahrefs REST API v3. Auth via Bearer token (`api_key` from `.pm/config.json`).
**DataForSEO adapter:** Calls DataForSEO REST API. Auth via Basic auth (`login` + `password` from `.pm/config.json`).

Skills invoke via Bash tool: `node ${CLAUDE_PLUGIN_ROOT}/scripts/seo-provider.js getKeywords example.com`

Reads `.pm/config.json` for provider choice and credentials (API key for Ahrefs, login + password for DataForSEO). Returns JSON to stdout.

### Cost Guardrails

| Operation | Estimated API calls | Ahrefs cost | DataForSEO cost |
|-----------|-------------------|-------------|-----------------|
| Keywords for 1 domain | 1 | Included in plan | ~$0.002 |
| Traffic for 1 domain | 1 | Included in plan | ~$0.002 |
| Backlinks for 1 domain | 1 | Included in plan | ~$0.01 |
| Full competitor profile (SEO) | 3-5 | Included in plan | ~$0.02 |
| Discover competitors for keyword set | 5-20 | Included in plan | ~$0.05 |

The research skill must confirm with the user before batch operations (e.g., "About to run SEO analysis on 5 competitors. This will use approximately 15-25 API calls. Proceed?").

## Groom State File Schema

`.pm/.groom-state.md`:

```yaml
---
phase: research          # intake | strategy-check | research | scope | groom | link
topic: "shift scheduling feature"
started: 2026-03-12
updated: 2026-03-12T14:30:00
strategy_check: passed   # passed | failed | skipped (no strategy doc)
research_location: pm/research/shift-scheduling/
confirmed_scope:
  in_scope:
    - "Basic shift templates"
    - "Drag-and-drop assignment"
  out_of_scope:
    - "AI-powered auto-scheduling"
issues:
  - slug: shift-templates
    status: drafted       # drafted | approved | created | linked
    linear_id: null
  - slug: drag-drop-assignment
    status: drafted
    linear_id: null
---

## Resume Instructions

Continue from the **research** phase. Competitor analysis is complete (see pm/competitors/).
Next step: present scope recommendations to user for approval.
Key context: user flagged auto-scheduling as out-of-scope due to non-goal in strategy.
```

**Error handling:**
- **Corrupted state file:** If YAML parse fails, show error to user with the file path. Offer to start fresh or manually fix.
- **Missing research references:** If state references a research file that was deleted, warn user and re-run that research step.
- **Strategy drift:** If strategy.md was modified since `strategy_check` timestamp, re-run strategy check and flag any scope changes.
- **Cleanup:** State file is deleted after link phase completes successfully. If user abandons mid-groom, state file persists for resume.

## Backlog Issue Format

When Linear is unavailable, issues are written to `pm/backlog/{issue-slug}.md`:

```yaml
---
type: backlog-issue
created: 2026-03-12
updated: 2026-03-12
status: open             # open | in-progress | done
priority: high           # critical | high | medium | low
parent: null             # slug of parent issue, or null for top-level
children:
  - shift-templates
  - drag-drop-assignment
labels:
  - scheduling
  - core-feature
research_refs:
  - pm/research/shift-scheduling/findings.md
  - pm/competitors/competitor-a/features.md
---

# Shift Scheduling System

## Outcome
Operators can create and assign shifts to workers across multiple locations.

## Acceptance Criteria
- [ ] Operators can create shift templates with start/end time, location, and role
- [ ] Shifts can be assigned to specific workers or left as open shifts
- [ ] Weekly and monthly calendar views show all shifts across locations
- [ ] Conflicts (double-booking) are detected and flagged

## Competitor Context
- Competitor A: Full scheduling with auto-fill. Overkill for our ICP.
- Competitor B: Basic templates only. No conflict detection.
- Our angle: Simple templates + conflict detection. Not auto-scheduling (see strategy non-goals).

## Research Links
- [Shift scheduling research](pm/research/shift-scheduling/findings.md)
- [Competitor A features](pm/competitors/competitor-a/features.md)
```

**Parent/child relationships:** Expressed via `parent` and `children` fields in frontmatter. The `index.md` file provides a flat list with hierarchy indicators.

## Versioning and Migration

Two separate version domains:
- **Plugin version** (`version` in `plugin.json`): semver (e.g., `1.2.0`). Tracks plugin releases. Managed by the plugin marketplace.
- **Config schema version** (`config_schema` in `.pm/config.json`): integer (e.g., `1`). Tracks the config file format. Only bumped when the config structure changes.

Migration runs when `config_schema` in the existing config < the `config_schema` expected by the current plugin code:
1. Read existing config
2. Apply transformations (add new fields with defaults, rename changed fields)
3. Write updated config with new `config_schema` number
4. Log what changed

A normal plugin update (new skills, bug fixes) does NOT trigger migration unless the config format actually changed.

- Content files (research, competitors, strategy) use frontmatter `type` field for format identification. New fields can be added without breaking existing files.
- Backward compatibility: the plugin must be able to read older content files. Missing frontmatter fields get defaults, not errors.

## Cross-Platform Support

### Architecture

Skills are platform-agnostic markdown. Platform differences are handled by separate manifests, tool mapping references, and bootstrap mechanisms. No conditional logic inside skills.

### Platform Manifests

| Platform | Manifest Location | Discovery |
|----------|------------------|-----------|
| Claude Code | `.claude-plugin/plugin.json` | Marketplace: `/plugin install pm` |
| Cursor | `.cursor-plugin/plugin.json` | Marketplace: `/add-plugin pm` |
| Codex | `.codex/INSTALL.md` | Manual: clone repo, install via `.codex/` convention |
| OpenCode | `.opencode/plugins/pm.js` | Manual: clone repo, symlink plugin + skills |
| Gemini CLI | `gemini-extension.json` + `GEMINI.md` | `gemini extensions install <repo-url>` |

### Tool Mapping

Skills use Claude Code tool names. Each platform maps to its own equivalents. Tool mapping references live in `skills/setup/references/`:

| Claude Code | Codex | Gemini CLI | OpenCode |
|-------------|-------|------------|----------|
| Read | (native) | read_file | read_file |
| Write | (native) | write_file | write_file |
| Edit | (native) | replace | edit_file |
| Bash | (native) | run_shell_command | run_command |
| Grep | (native) | grep_search | grep |
| Glob | (native) | glob | glob |
| WebSearch | web | google_search | web_search |
| WebFetch | web | fetch_url | fetch |
| Agent (subagent) | spawn_agent | N/A (fallback to inline) | N/A |
| Skill | (native discovery) | activate_skill | (plugin hook) |

### Platform-Specific Handling

**Subagent support:** The researcher agent requires subagent dispatch. Platforms without subagent support (Gemini, OpenCode) fall back to sequential competitor profiling inline.

**Visual companion:** The start-server.sh script detects the platform:
- Claude Code: background execution (default)
- Codex: auto-foreground (detects `CODEX_CI` env var, Codex reaps background processes)
- Gemini CLI: `--foreground` flag with background shell launch
- Remote/containerized: bind to `0.0.0.0` with custom `--url-host`

**SEO provider script:** `scripts/seo-provider.js` is platform-agnostic (Node.js, invoked via Bash/shell tool). Works on all platforms with Node.js installed.

### Bootstrap Mechanism

Each platform has a different way to make the plugin discoverable:

- **Claude Code / Cursor:** Marketplace auto-discovery via plugin.json. Skills loaded on demand via Skill tool.
- **Codex:** Clone repo, install skills via `.codex/` directory convention. Skills auto-discovered via Codex's native skill loading.
- **OpenCode:** JavaScript plugin (`pm.js`) uses `experimental.chat.system.transform` hook to inject the setup/bootstrap skill content on every request.
- **Gemini CLI:** Extension system loads `GEMINI.md` at session start. GEMINI.md contains the bootstrap instructions and tool mappings.

### Installation Guides

Each platform gets its own installation guide:
- `.codex/INSTALL.md` - Clone, install via `.codex/` convention, optional collab config for subagents
- `.opencode/INSTALL.md` - Clone, plugin + skills symlinks, Windows junction support
- `README.md` - Claude Code / Cursor (primary), with cross-platform section

## Plugin File Structure

```
pm/
+-- .claude-plugin/
|   +-- plugin.json
+-- .cursor-plugin/
|   +-- plugin.json
+-- .codex/
|   +-- INSTALL.md                  # Codex setup guide
+-- .opencode/
|   +-- plugins/
|   |   +-- pm.js                   # OpenCode bootstrap plugin
|   +-- INSTALL.md                  # OpenCode setup guide
+-- GEMINI.md                       # Gemini CLI entry point
+-- gemini-extension.json           # Gemini extension manifest
+-- skills/
|   +-- setup/
|   |   +-- SKILL.md
|   |   +-- references/
|   |       +-- codex-tools.md      # Codex tool name mappings
|   |       +-- gemini-tools.md     # Gemini CLI tool name mappings
|   +-- strategy/
|   |   +-- SKILL.md
|   |   +-- interview-guide.md      # adaptive interview structure
|   +-- research/
|   |   +-- SKILL.md
|   |   +-- competitor-profiling.md  # deep profiling methodology
|   |   +-- review-mining.md        # how to extract signal from reviews
|   |   +-- api-analysis.md         # how to analyze competitor APIs
|   +-- groom/
|   |   +-- SKILL.md
|   |   +-- scope-validation.md     # 10x filter, strategy alignment checks
|   +-- dig/
|       +-- SKILL.md
+-- commands/
|   +-- setup.md
|   +-- strategy.md
|   +-- research.md
|   +-- groom.md
|   +-- dig.md
|   +-- view.md
+-- agents/
|   +-- researcher.md               # autonomous research subagent
+-- scripts/
|   +-- seo-provider.js             # zero-dep SEO API adapter (Ahrefs + DataForSEO)
|   +-- server.js                   # visual companion server (adapted from superpowers)
|   +-- helper.js                   # browser interaction layer
|   +-- frame-template.html         # PM-branded template
|   +-- start-server.sh
|   +-- stop-server.sh
+-- templates/
|   +-- competitor-matrix.html
|   +-- strategy-canvas.html
|   +-- scope-grid.html
|   +-- issue-preview.html
|   +-- research-dashboard.html
+-- hooks/
|   +-- hooks.json                  # first-run detection
|   +-- check-setup.sh             # first-run gate script
+-- README.md
+-- LICENSE
```

## What Makes This 10x

1. **Compounding knowledge base.** Every session adds to `pm/`. Most PM tools treat each session as standalone. This plugin remembers everything about your market and competitors.

2. **Strategy alignment as a hard gate.** Features that don't align get flagged explicitly. Not buried in a backlog, but challenged at intake. Prevents waste.

3. **Deep competitor intelligence.** API docs, support pages, review sentiment, SEO data, changelogs. Understanding WHY competitors built what they built, not just WHAT.

4. **Composable, not monolithic.** Use just research. Use just strategy. Use the full lifecycle. Each skill pays for itself independently.

5. **Visual companion for PM decisions.** Competitor matrices and scope grids in the browser. PMs think visually. Terminal walls of text don't cut it.

6. **Upstream of engineering.** Well-groomed issues with research links flow into superpowers' implementation workflow. PM and engineering share a common knowledge base.

7. **Works anywhere.** Claude Code, Cursor, Codex, OpenCode, Gemini CLI. Ahrefs or DataForSEO or web-only. Linear or local markdown. Each platform gets native manifests and installation guides, not a "Claude Code only" afterthought.

8. **Opinionated structure.** Not "put your files wherever." One folder structure, one convention, one way to organize competitive intelligence. Consistency enables compounding.

## Non-Goals

- Not a project management tool (no sprints, no velocity, no burndown)
- Not a design tool (no mockups, no wireframes beyond scope visualization)
- Not an analytics dashboard (no runtime metrics, no A/B testing)
- Not a CRM (no customer management, no pipeline tracking)
- Not a communication tool (no Slack integration, no stakeholder updates)

## Resolved Questions

1. **Research resumability:** Yes. Competitor profiling dispatches parallel researcher agents (one per competitor). Each writes independently to `pm/competitors/{slug}/`. If interrupted, existing files persist and the next run picks up where it left off by checking which profiles are complete vs incomplete. No state file needed, the file system IS the state.
2. **Changelog monitoring:** On-demand only for v1. User runs `/pm:research competitors` to refresh. Periodic monitoring is a future enhancement.
3. **Multi-project support:** `.pm/` is project-scoped (lives in project root). This is the right default. Shared knowledge bases across projects is out of scope for v1.
