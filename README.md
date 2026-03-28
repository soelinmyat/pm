# PM — Product Memory

A plugin for AI coding assistants that helps you figure out **what to build** and then **build it well**.

Most tools help you write code faster. PM helps you write the *right* code — by researching your market, tracking competitors, planning features, and then implementing them with structured workflows. Everything stays in your editor. Nothing gets lost.

Works with Claude Code, Cursor, Codex, and Gemini CLI.

PM activates the right workflow automatically — no commands to memorize.

---

## What It Does

**Think** — Research your market, study competitors, and build a product strategy. PM saves everything so it gets smarter over time.

**Plan** — Turn ideas into well-defined issues. Each idea goes through research, scoping, and multiple rounds of review before becoming a ticket.

**Build** — Implement features with test-driven development, multi-perspective code review, QA ship gates, and PR workflows. If an issue was already planned through PM, the dev workflow skips redundant steps and goes straight to coding.

---

## Install

**Claude Code:**
```bash
claude plugin marketplace add soelinmyat/pm
claude plugin install pm@pm
```

**Cursor:** Copy `.cursor-plugin/` into your project root.

**Codex:** See [`.codex/INSTALL.md`](.codex/INSTALL.md).

**Gemini CLI:** See [`GEMINI.md`](GEMINI.md).

---

## Get Started

**Start with what you want to build.** Tell PM your feature idea and it will research the market, scope the work, and produce ready-to-build issues — all in one conversation.

**Or start with what you want to learn.** Ask PM to research a topic, map competitors, or analyze your market. The research accumulates in your knowledge base and informs future planning.

Everything else — setup, strategy, ideation, ingestion — happens on-demand when the workflow needs it. You don't need to memorize anything.

---

## What You Can Do

### Think

- **Research** a topic, competitor, or market trend
- **Build a strategy** with product positioning, ICP, and strategic bets — auto-generates a presentation deck
- **Generate ideas** based on your research and strategy
- **Groom** an idea through research, scoping, and multi-agent review into ready-to-build issues
- **Dig** into a specific question for quick inline answers
- **Import** customer feedback, interviews, or support data
- **Refresh** stale research without losing existing content
- **Browse** your knowledge base in a local dashboard with charts, positioning maps, and backlog views

### Build

- **Develop** any work — single features, multi-issue epics, or batch bug triage. One unified workflow auto-detects scope and routes to the right flow.
- **Test-first discipline** — TDD for all sizes, with parallel agent dispatch for independent tasks
- **Multi-perspective review** — up to 5 agents (code, PM, design, input edge-cases, official code review) run in parallel
- **QA ship gate** — automated exploratory and scripted testing with Playwright (web) or Maestro (mobile), health scoring, and pass/fail verdicts
- **Design critique** — multi-agent visual review against real app screenshots
- **Ship** — push, PR, CI monitoring, gate polling, and auto-merge in one command

---

## How the Handoff Works

When you groom a feature, PM takes it through research, scoping, and review. The output includes detailed acceptance criteria, user flows, wireframes, and competitive context.

When you then build that same feature, the dev workflow sees the grooming work and skips straight to implementation — no redundant brainstorming or spec review. The research context flows into the implementation plan automatically.

This is the main idea: **think once, build fast.**

---

## Visual Dashboard

Every major workflow offers to open a browser-based dashboard alongside your editor. The dashboard shows:

- **Home** — control tower with backlog stats, active sessions, strategy health
- **Backlog** — proposal cards, kanban board, search/filter, shipped and archived views
- **Research** — landscape overview, competitor profiles with tabbed detail pages, topic cards with freshness indicators
- **Strategy** — rendered strategy with positioning maps, SWOT grids, and a slide deck viewer

The dashboard is read-only and local — it renders your `pm/` knowledge base files with no external services.

---

## Skills

| Skill | What it does |
|-------|-------------|
| `pm:dev` | Unified development — auto-detects single issue, epic, or batch bug triage |
| `pm:groom` | Convert ideas into sprint-ready issues through research and multi-agent review |
| `pm:research` | Landscape mapping, competitor deep-dives, topic research, quick inline questions |
| `pm:strategy` | Product positioning, ICP, competitive positioning, priorities, slide deck |
| `pm:ship` | Push, PR, CI monitor, gate polling, auto-merge |
| `pm:review` | Multi-perspective code review + feedback handling |
| `pm:qa` | QA ship gate — test charter, Playwright/Maestro testing, health score verdict |
| `pm:tdd` | Test-first discipline — write test, watch fail, implement |
| `pm:subagent-dev` | Dispatch parallel agents for plan execution |
| `pm:debugging` | Root cause investigation before any fix |
| `pm:design-critique` | Multi-agent visual critique with screenshots |
| `pm:brainstorming` | Explore intent and design before code |
| `pm:ingest` | Import customer evidence from files or folders |
| `pm:refresh` | Audit research for staleness and patch gaps |
| `pm:view` | Open the knowledge base dashboard |
| `pm:setup` | First-time configuration |

You rarely need to call these directly — PM routes to the right skill based on what you say.

---

## The `pm/` Directory

You'll notice a `pm/` folder in this repo. That's PM dogfooding itself — we use the plugin to manage its own development. When you install PM in your project, you'll get your own fresh `pm/` folder the first time you start a workflow.

---

## Feedback

- [Open an issue](https://github.com/soelinmyat/pm/issues)
- [Start a discussion](https://github.com/soelinmyat/pm/discussions)

## Acknowledgments

Inspired by [Superpowers](https://github.com/obra/superpowers), [Impeccable](https://github.com/pbakaus/impeccable), and [gstack](https://github.com/garrytan/gstack) (the multi-role virtual team approach).

## License

MIT. See [LICENSE](./LICENSE).
