# PM — Shared Product Brain for Small Teams

[![CI](https://github.com/soelinmyat/pm/actions/workflows/ci.yml/badge.svg)](https://github.com/soelinmyat/pm/actions/workflows/ci.yml)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.0.62-brightgreen.svg)](plugin.config.json)

PM is a free, open-source plugin for Claude Code and Codex. It keeps market research, strategy, competitor context, groomed work, and delivery state in one place inside the repo — context that compounds over time, not another doc that decays after the meeting.

> **Early release.** Research, strategy, grooming, and shipping work well. KB sync across machines is functional but still being polished.

## Why PM?

Product context decays. The research doc goes stale, the strategy deck is six months old, and nobody remembers why you decided against that feature.

PM fixes this by making product knowledge **durable** and **wired into your workflow**:

- Every `/pm:dev` session builds on prior `/pm:research` and `/pm:groom` — context compounds instead of decaying
- Research, strategy, and competitive intel live in your repo, not in a separate tool nobody opens
- Evidence flows into insights, insights inform strategy, strategy gates grooming, grooming gates dev

Built for teams where roles blur. The engineer makes product calls. The PM ships minor features. The designer reviews implementation. The biz lead needs context without asking for updates.

## What PM Is Not

- Not a project management tool — Linear and Jira handle sprints and assignments
- Not a standalone analytics product
- Not an enterprise workflow suite

PM handles the thinking layer: what to build, why it matters, and how that context carries through the work.

## Quickstart

```text
/pm:start
```

That's it. PM detects whether you're new or resuming and routes you to the right workflow.

A typical first session:

```text
/pm:start                          # bootstrap the knowledge base
/pm:research landscape             # scan the market
/pm:strategy                       # define ICP, positioning, priorities
/pm:groom "feature idea"           # scope and spec the first feature
```

If you have customer evidence (support tickets, interview notes, sales calls), ingest it before research:

```text
/pm:ingest ~/path/to/evidence
```

## What PM Creates

PM writes committed product context to `pm/` and runtime state to `.pm/`.

```text
pm/
  strategy.md                  # ICP, positioning, priorities, non-goals
  evidence/
    research/                  # market landscape, topic research
    competitors/               # competitor profiles and intel
    transcripts/               # ingested interview/call transcripts
    user-feedback/             # ingested customer evidence
  insights/                    # synthesized product and business insights
  backlog/                     # proposals, RFCs, wireframes
    rfcs/                      # implementation plans (HTML)
  thinking/                    # pre-commitment exploration artifacts
  product/
    features.md                # feature inventory

.pm/
  config.json                  # integration config (Linear, Ahrefs)
  dev-sessions/                # active dev session state
  groom-sessions/              # active groom session state
```

`pm/` is the durable product memory — commit it. `.pm/` is runtime state — gitignore it.

### Example output

A backlog entry after grooming:

```yaml
---
id: "PM-042"
title: "Dashboard Filtering System"
outcome: "Users can narrow dashboard data to their team's metrics"
status: proposed
priority: high
labels: [dashboard, ux]
research_refs:
  - pm/evidence/research/dashboard-filtering.md
created: 2026-04-01
updated: 2026-04-01
---
```

A research finding:

```yaml
---
type: research
topic: dashboard-filtering
source_origin: web
created: 2026-04-01
updated: 2026-04-01
sources:
  - url: "https://example.com/analytics-trends"
    title: "Analytics Dashboard Trends 2026"
---

## Key Findings

1. 78% of analytics users filter by team or department daily
2. Most competitors offer 3-5 filter dimensions; power users want saved filters
```

## Install

### Claude Code

```bash
claude plugin marketplace add soelinmyat/pm
claude plugin install pm@pm
```

### Codex

PM ships a native Codex plugin manifest at `.codex-plugin/plugin.json`. Skills appear as `pm:groom`, `pm:research`, `pm:dev`, etc.

If your Codex install isn't loading the plugin directly yet, see the fallback steps in [`.codex/INSTALL.md`](.codex/INSTALL.md).

### Other platforms

PM officially supports Claude Code and Codex. Community contributions for other platforms are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## Core Workflows

### Product discovery

| Command | What it does |
|---|---|
| `/pm:start` | Bootstrap the knowledge base or resume where you left off |
| `/pm:think` | Structured product thinking — challenge assumptions, explore tradeoffs |
| `/pm:research <topic>` | Market landscape, competitor profiling, or focused topic research |
| `/pm:strategy` | Create or update ICP, positioning, priorities, and non-goals |
| `/pm:groom [idea]` | Turn an idea into a scoped proposal with research and competitive context |

### Development and delivery

| Command | What it does |
|---|---|
| `/pm:dev [ticket]` | Auto-detects scope, generates RFC, implements with TDD |
| `/pm:ship [PR]` | Review, push, create PR, monitor CI, and merge |

### Knowledge base management

| Command | What it does |
|---|---|
| `/pm:ingest <path>` | Import customer evidence from files or folders |
| `/pm:note` | Quick-capture product observations and customer signals |
| `/pm:refresh [scope]` | Audit research for staleness and patch gaps |
| `/pm:sync [push\|pull\|status]` | Sync knowledge base changes across machines |
| `/pm:setup` | Enable or disable integrations (Linear, Ahrefs) |

## How PM Fits a Team

- **Engineers** use it in the editor — research, groom, build, ship
- **PMs and biz leads** use the knowledge base for strategy, research, and roadmap context
- **Designers** review proposals and implementation against the original intent

The knowledge base is the shared context. Everyone works from the same research, strategy, and decisions.

## Pricing

PM is free to use locally. Syncing knowledge bases across machines via [productmemory.io](https://productmemory.io) requires a Publisher account.

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for how the plugin works at runtime — skill loading, step execution, agent dispatch, and state management.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to add platform support, create commands and skills, run tests, and submit PRs.

## Feedback

- Open an [issue](https://github.com/soelinmyat/pm/issues)
- Start a [discussion](https://github.com/soelinmyat/pm/discussions)

## License

MIT. Copyright (c) 2026 Soe Lin Myat. See [LICENSE](./LICENSE).
