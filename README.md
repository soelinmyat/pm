# PM — Product Memory

Structured workflows for the product engineer, on top of whatever AI coding assistant you already use.

PM is a free, open-source plugin that gives product engineers end-to-end workflows from idea through shipped code. Research compounds over time instead of getting lost. Strategy is checked before anyone writes code. Groomed issues flow into implementation with reduced ceremony. The tool remembers so you don't have to.

**Three goals:**
1. **Build valuable products** — research, strategy, competitive analysis, and customer evidence ensure you build the right thing.
2. **Build efficiently** — ceremony calibration, TDD, one-shot implementation, auto-merge. Faster and more autonomous.
3. **Manage cognitive load** — external memory that surfaces the right context at the right time.

Built for Claude Code. Also works with Cursor, Codex, and Gemini CLI.

> **v1.1.0** merges PM (product discovery) and Dev (development lifecycle) into a single plugin. 23 skills, 17 commands, one install. Groomed issues automatically skip redundant brainstorming and spec review in the dev workflow.

---

## Installation

### Claude Code

```bash
claude plugin marketplace add soelinmyat/pm
claude plugin install pm@pm
```

### Cursor

Copy the `.cursor-plugin/` directory into your project root, or install via Cursor's plugin marketplace once published.

### Codex

Codex installs PM as a bundle of skills, not a `plugins:` config entry. Follow the Codex-specific guide in [`.codex/INSTALL.md`](.codex/INSTALL.md).

### OpenCode, Gemini CLI

These platforms do not have a one-line install. See the platform-specific guides:

- **OpenCode:** [`.opencode/INSTALL.md`](.opencode/INSTALL.md)
- **Gemini CLI:** Clone the repo and add it to your Gemini extensions. See [`GEMINI.md`](GEMINI.md).

---

## About the `pm/` directory in this repo

The `pm/` directory contains Product Memory's own knowledge base — landscape research, competitor profiles, strategy, and backlog. This is PM dogfooding itself: the plugin is used to manage its own product development. It is not part of the plugin's source code or execution. When you install PM in your project, your own `pm/` directory will be generated fresh by `/pm:setup` or `$pm-setup` in Codex.

---

## Quick Start

### Product Discovery → Implementation

```
/pm:setup                              # configure product context and integrations
/pm:research landscape                 # map the competitive landscape
/pm:strategy                           # synthesize positioning and priorities
/pm:ideate                             # generate ranked feature ideas
/pm:groom                              # full grooming: research → scope → review → issues
/pm:dev                                # implement with TDD, review, PR, merge
/pm:dev-epic PM-044                    # orchestrate a multi-issue epic end-to-end
```

When a groomed issue reaches `/pm:dev` or `/pm:dev-epic`, the dev workflow detects the grooming artifacts and skips brainstorming and spec review — going straight to implementation planning.

### Codex

```text
$pm-setup
$pm-research landscape
$pm-strategy
$pm-ideate
$pm-groom
$pm-dev
$pm-dev-epic PM-044
```

---

## Commands

### Product Discovery (PM)

| Command | Description |
|---------|-------------|
| `/pm:setup` | First-time configuration: product context, market, integrations |
| `/pm:ingest <path>` | Import customer evidence from local files or folders |
| `/pm:strategy` | Generate and refine product positioning and strategic bets |
| `/pm:research <topic>` | Landscape mapping, competitor deep-dives, market signal analysis |
| `/pm:ideate` | Generate ranked feature ideas from your knowledge base |
| `/pm:groom` | Full grooming pipeline: research → scope → review → bar raiser → issues |
| `/pm:dig <question>` | Quick inline research for mid-work decisions |
| `/pm:refresh [scope]` | Audit research for staleness and patch without losing content |
| `/pm:view` | Open the knowledge base dashboard in your browser |

### Development Lifecycle (Dev)

| Command | Description |
|---------|-------------|
| `/pm:dev` | Full lifecycle: brainstorm → plan → TDD → review → PR → merge |
| `/pm:dev-epic <id>` | Orchestrate a multi-issue epic with parallel agents |
| `/pm:pr` | PR preparation: review, push, create PR, CI monitor |
| `/pm:review` | Multi-perspective code review (code + PM + design + edge-cases) |
| `/pm:merge-watch` | Poll PR readiness gates, auto-merge when ready |
| `/pm:merge` | Merge a PR, delete branch, clean up |
| `/pm:bug-fix` | Batch bug triage and resolution |

### Internal Skills (invoked by workflows, not directly)

brainstorming, debugging, design-critique, receiving-review, subagent-dev, tdd, using-pm, writing-plans

---

## How It Works

```
Research → Strategy → Groom → Dev → Ship
   │          │         │       │
   │          │         │       ├── TDD + implementation
   │          │         │       ├── Code review (multi-perspective)
   │          │         │       └── PR + auto-merge
   │          │         │
   │          │         ├── Scope review (3 agents: PM, Competitive, EM)
   │          │         ├── Team review (3-4 agents)
   │          │         └── Bar raiser (Product Director)
   │          │
   │          └── Goals, non-goals, ICP, competitive positioning
   │
   └── Landscape, competitors, customer evidence, market signals
```

Context compounds at every stage. Research informs grooming. Grooming shapes implementation. Implementation references competitive analysis. The 100th groomed ticket is dramatically better than the first.

---

## Feedback

Ideas, bug reports, and workflow suggestions are welcome.

- Open an [issue](https://github.com/soelinmyat/pm/issues)
- Start a [discussion](https://github.com/soelinmyat/pm/discussions)

---

## Acknowledgments

PM draws inspiration from several excellent Claude Code plugins:

- [Superpowers](https://github.com/obra/superpowers) — pioneered many patterns for plugin skill design
- [Impeccable](https://github.com/pbakaus/impeccable) — raised the bar for design-aware development workflows
- [gstack](https://github.com/garrytan/gstack) — headless browser tooling and QA automation

## License

MIT. Copyright (c) 2026 Soe Lin Myat. See [LICENSE](./LICENSE).
