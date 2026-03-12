# PM — Product Memory

PM is a cross-platform plugin for AI coding assistants that helps product engineers decide **what to build**, turn that into **well-defined work**, and then **ship it with structure**.

It is built for people who own both product thinking and implementation: founders, engineers doing discovery, PMs who code, and small teams that want research, planning, and development to happen in one place.

## What PM Does

PM supports a simple lifecycle:

- **Research** your market, competitors, and customer signals
- **Strategy** to clarify ICP, positioning, and priorities
- **Groom** ideas into sprint-ready issues with acceptance criteria, user flows, and context
- **Build** with TDD, review, QA, and shipping workflows

The key idea is: **think once, build fast**.

## What Happens in Your Repo

PM creates two directories in your project:

```text
pm/      # committed knowledge base
.pm/     # gitignored runtime state and config
```

Typical artifacts include:

- `pm/landscape.md` — market landscape research
- `pm/strategy.md` — product strategy
- `pm/competitors/` — competitor profiles
- `pm/research/` — topic research and synthesized findings
- `pm/backlog/` — markdown backlog items when Linear is not used
- `.pm/config.json` — integration and preference settings
- `.pm/evidence/` — normalized customer evidence records

## Who PM Is For

PM is a strong fit if you:

- use an AI coding assistant and also make product decisions
- want research and planning artifacts to persist between sessions
- prefer editor-native workflows over jumping across many tools
- want product context to flow directly into implementation

PM is probably not the best fit if you only want a code-generation helper with no research or planning layer.

## Install

### Claude Code

```bash
claude plugin marketplace add soelinmyat/pm
claude plugin install pm@pm
```

### Cursor

Copy `.cursor-plugin/` into your project root.

### Codex

See [`.codex/INSTALL.md`](.codex/INSTALL.md).

### Gemini CLI

See [`GEMINI.md`](GEMINI.md).

## Quick Start

You do **not** need to memorize every workflow.

Start with plain-English prompts like:

- "Set up PM for this repo."
- "Research our market and key competitors."
- "Turn this feature idea into sprint-ready issues."
- "Build the groomed issue for bulk editing."
- "Open the PM dashboard."

A common progression looks like this:

1. Set up project context
2. Import customer evidence (optional)
3. Research the landscape
4. Define strategy
5. Groom ideas into issues
6. Implement and ship

## Workflows

### Entry Points

- **Research** — landscape, competitor, topic, and quick inline research
- **Strategy** — ICP, positioning, priorities, and deck generation
- **Groom** — turn ideas into ready-to-build issues through multi-agent review
- **Dev** — implement features, refactors, bug triage, and epics (auto-detects scope)
- **Ship** — review, PR, CI monitoring, gate polling, and auto-merge

### Utilities

- **Setup** — configure project context, integrations, and folder structure
- **View** — open the local dashboard
- **Ingest** — import support tickets, interview notes, and other evidence
- **Refresh** — update stale research without losing accumulated knowledge

## Optional Integrations

PM works without external integrations, but can optionally use:

- **Linear** for issue tracking instead of markdown backlog files
- **Ahrefs MCP** for SEO-aware research

Without those, PM uses web research and writes backlog items to `pm/backlog/`.

## Dashboard

PM includes a local browser dashboard for browsing the knowledge base. It is read-only with no external services. It shows:

- **Home** — control tower with backlog stats, active sessions, strategy health
- **Backlog** — proposal cards, search/filter, shipped and archived views
- **Research** — landscape, competitor profiles with tabbed detail, topic cards with freshness indicators
- **Strategy** — rendered strategy with positioning maps, SWOT grids, and slide deck viewer

## Example Outputs

This repository dogfoods PM on itself, so you can browse real outputs:

- [`pm/strategy.md`](pm/strategy.md) — product strategy
- [`pm/landscape.md`](pm/landscape.md) — market landscape
- [`pm/competitors/`](pm/competitors/) — competitor profiles
- [`pm/research/`](pm/research/) — topic research

## Why This Repo Contains a `pm/` Folder

The `pm/` directory in this repository is PM using itself. It is **example product data**, not the plugin source code. The plugin source lives in `skills/`, `agents/`, `hooks/`, and `scripts/`.

---

## Feedback

- [Open an issue](https://github.com/soelinmyat/pm/issues)
- [Start a discussion](https://github.com/soelinmyat/pm/discussions)

## Acknowledgments

Inspired by [Superpowers](https://github.com/obra/superpowers), [Impeccable](https://github.com/pbakaus/impeccable), and [gstack](https://github.com/garrytan/gstack).

## License

MIT. See [LICENSE](./LICENSE).
