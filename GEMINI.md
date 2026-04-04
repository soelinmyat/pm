# PM Plugin

A cross-platform AI plugin that gives Product Managers structured workflows for product discovery, competitive intelligence, and feature grooming. It turns raw ideas and market signals into well-researched strategies and ready-to-build Linear issues, all without leaving your editor.

---

## Bootstrap Instructions

### First-time setup

Run setup to configure your product context, integrations, and knowledge base folder structure:

```
/pm:setup
```

Setup configures:
- Product context and target market
- Linear integration (or markdown backlog fallback if unavailable)
- SEO provider: Ahrefs MCP (recommended) or web search only
- Knowledge base folders: `pm/` (committed) and `.pm/` (gitignored runtime/config)

### Recommended workflow

```
/pm:setup
/pm:ingest ~/path/to/customer-evidence   # optional, when you already have support/interview/sales data
/pm:research landscape
/pm:strategy
/pm:research competitors
/pm:groom
```

---

## Available Skills

| Command | Description |
|---------|-------------|
| `/pm:setup` | First-time configuration: product context, market, integrations |
| `/pm:ingest <path>` | Import customer evidence from local files or folders and update shared research artifacts |
| `/pm:strategy` | Generate and refine product positioning and strategic bets |
| `/pm:research <topic>` | Landscape mapping, competitor deep-dives, user signal analysis |
| `/pm:groom` | Convert strategy into groomed Linear issues ready for sprint |
| `/pm:dig <question>` | Ad-hoc deep research on a specific question or topic |
| `/pm:refresh [scope]` | Audit research for staleness and missing data, then patch without losing existing content |
| `/pm:view` | Browse and search accumulated research and strategy artifacts |

---

## Tool Mapping

The PM plugin is written for Claude Code but runs on Gemini CLI with the following tool equivalents:

| Claude Code Tool | Gemini Equivalent | Notes |
|------------------|-------------------|-------|
| Read | `read_file` | Same semantics. Read file contents by path. |
| Write | `write_file` | Same semantics. Write/create file with content. |
| Edit | `edit_file` | Patch/modify existing files. |
| Bash | `run_shell_command` | Execute shell commands. |
| Glob | `list_directory` | Pattern-based file listing. |
| Grep | `search_in_files` | Content search across files. |
| WebSearch | `google_search` | Search the web. |
| WebFetch | `read_url` | Fetch and process URL content. |
| Agent | (not available) | See sequential fallback note below. |

---

## Subagent Limitation

Gemini CLI does not support multiagent spawning. The PM plugin uses parallel researcher agents in `/pm:research` on Claude Code. On Gemini CLI, use sequential fallback instead:

```
Claude Code (parallel):
  - Spawn Agent 1 -> research competitor A
  - Spawn Agent 2 -> research competitor B
  - Coordinate results

Gemini CLI (sequential):
  - google_search: competitor A features, pricing, messaging
  - google_search: competitor B features, pricing, messaging
  - Merge results in the next prompt turn
```

All other skills (setup, strategy, groom, dig, view) work identically on Gemini CLI because they do not use parallel agents.

---

## Knowledge Base Layout

```
pm/                   # Committed knowledge base
  competitors/        # Competitor profiles written by /pm:research competitors
  research/           # Shared topic research written by /pm:research and /pm:ingest
  backlog/            # Markdown issues (used only if Linear is unavailable)
.pm/                  # Gitignored runtime/config
  config.json         # Integration settings (Linear, SEO provider)
  imports/            # Import manifest for /pm:ingest
  evidence/           # Normalized customer evidence records
  sessions/           # Dashboard session canvas state
```

Skills read from and write to this layout. `/pm:view` browses accumulated artifacts. `/pm:strategy` synthesizes whatever research exists in `pm/`.
