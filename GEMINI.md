# PM Plugin

Structured workflows for the product engineer — from discovery and strategy through implementation and merge. A cross-platform AI plugin that turns raw ideas and market signals into well-researched strategies and ready-to-build issues, then ships them through a structured development lifecycle, all without leaving your editor.

---

## Bootstrap Instructions

### First-time setup

Tell PM about your project and it will configure your product context, integrations, and knowledge base folder structure automatically.

Setup configures:
- Product context and target market
- Linear integration (or markdown backlog fallback if unavailable)
- SEO provider: Ahrefs MCP (recommended) or web search only
- Knowledge base folders: `pm/` (committed) and `.pm/` (gitignored runtime/config)

### Recommended workflow

Start by grooming a feature idea — PM will research the market, scope the work, and produce ready-to-build issues. Or start with research if you want to explore first.

A typical progression:
1. Set up your project context
2. Import any existing customer evidence (optional)
3. Research your market landscape
4. Define your product strategy
5. Research specific competitors
6. Groom ideas into sprint-ready issues
7. Implement groomed issues end-to-end

---

## Available Skills

### Product Discovery

| Capability | Description |
|-----------|-------------|
| Setup | First-time configuration: product context, market, integrations |
| Ingest | Import customer evidence from local files or folders and update shared research artifacts |
| Strategy | Generate and refine product positioning and strategic bets |
| Research | Landscape mapping, competitor deep-dives, user signal analysis |
| Groom | Convert strategy into groomed issues ready for sprint |
| Refresh | Audit research for staleness and missing data, then patch without losing existing content |
| View | Browse and search accumulated research and strategy artifacts |

### Development Lifecycle

| Capability | Description |
|-----------|-------------|
| Dev | Unified development — auto-detects single issue, epic, or batch bug triage |
| Brainstorming | Explore intent and design before code for creative work |
| Writing-plans | Produce an implementation plan before code for multi-step tasks |
| TDD | Test-first discipline — write test, watch fail, implement |
| Subagent-dev | Dispatch parallel agents for plan execution |
| Debugging | Root cause investigation before any fix |
| Receiving-review | Technical rigor — verify before implementing review suggestions |
| Review | Multi-perspective code review |
| Design-critique | Multi-agent visual critique with screenshots |
| QA | Ship gate — test charter, Playwright/Maestro testing, health score verdict |
| Ship | Review, push, PR, CI monitor + auto-fix |
| Sync | Sync plugin source to cache for testing |

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

Gemini CLI does not support multiagent spawning. The PM plugin uses parallel agents in research and dev-epic workflows on Claude Code. On Gemini CLI, use sequential fallback instead:

```
Claude Code (parallel):
  - Spawn Agent 1 -> research competitor A / implement sub-issue 1
  - Spawn Agent 2 -> research competitor B / implement sub-issue 2
  - Coordinate results

Gemini CLI (sequential):
  - google_search: competitor A features, pricing, messaging
  - google_search: competitor B features, pricing, messaging
  - Merge results in the next prompt turn
```

All other skills work identically on Gemini CLI because they do not use parallel agents.

---

## Knowledge Base Layout

```
pm/                   # Committed knowledge base
  competitors/        # Competitor profiles from research
  research/           # Shared topic research from research and ingest workflows
  backlog/            # Markdown issues (used only if Linear is unavailable)
.pm/                  # Gitignored runtime/config
  config.json         # Integration settings (Linear, SEO provider)
  imports/            # Import manifest for ingest workflow
  evidence/           # Normalized customer evidence records
  sessions/           # Visual companion session state
```

Skills read from and write to this layout. The view skill browses accumulated artifacts. The strategy skill synthesizes whatever research exists in `pm/`.
