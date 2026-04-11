# PM — Shared Product Brain for Small Teams

PM is a free, open-source plugin for Claude Code and Codex. It keeps market research, strategy, competitor context, groomed work, and delivery state in one place inside the repo — context that compounds over time, not another doc that decays after the meeting.

Built for teams where roles blur. The engineer makes product calls. The PM ships minor features. The designer reviews implementation. The biz lead needs context without asking for updates.

> **Early release.** Research, strategy, grooming, and shipping work well. The dashboard and collaboration layer are still being polished.

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

## Install

#### Claude Code

```bash
claude plugin marketplace add soelinmyat/pm
claude plugin install pm@pm
```

#### Codex

PM ships a native Codex plugin manifest at `.codex-plugin/plugin.json`. Skills appear as `pm:groom`, `pm:research`, `pm:dev`, etc.

If your Codex install isn't loading the plugin directly yet, use the fallback steps in [`.codex/INSTALL.md`](.codex/INSTALL.md).

#### Other platforms

PM officially supports Claude Code and Codex. Community contributions for other platforms are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

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
  backlog/                     # proposals, RFCs, wireframes
    proposals/                 # HTML PRDs
    rfcs/                      # implementation plans
  thinking/                    # pre-commitment exploration artifacts
  insights/                    # synthesized product and business insights
  product/
    features.md                # feature inventory

.pm/
  config.json                  # integration config (Linear, Ahrefs)
  dev-sessions/                # active dev session state
  groom-sessions/              # active groom session state
```

`pm/` is the durable product memory — commit it. `.pm/` is runtime state — gitignore it.

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
- **PMs and biz leads** use the dashboard for strategy, research, and roadmap context
- **Designers** review proposals and implementation against the original intent

The knowledge base is the shared context. Everyone works from the same research, strategy, and decisions.

## What PM Is Not

- Not a project management tool — Linear and Jira handle sprints and assignments
- Not a standalone analytics product
- Not an enterprise workflow suite

PM handles the thinking layer: what to build, why it matters, and how that context carries through the work.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to add platform support, create commands and skills, run tests, and submit PRs.

## Feedback

- Open an [issue](https://github.com/soelinmyat/pm/issues)
- Start a [discussion](https://github.com/soelinmyat/pm/discussions)

## License

MIT. Copyright (c) 2026 Soe Lin Myat. See [LICENSE](./LICENSE).
