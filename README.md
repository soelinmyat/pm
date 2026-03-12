# PM Plugin

PM is a Claude Code plugin for product discovery, competitive research, strategy, and backlog grooming.

LLMs and coding agents changed the cost of building. What used to take a team weeks now takes hours. But the bottleneck did not disappear. It moved upstream.

Knowing what to build is now the hard part. Not the code. The research, the strategy, the scoping, and the "should we even do this?" conversations. Most teams still do this manually: scattered notes, ad hoc web searches, gut-feel prioritization, and tribal knowledge that lives in someone's head.

PM gives product managers, founders, and builders structured workflows for that upstream work, inside the editor. Research compounds over time instead of getting lost. Strategy is checked before anyone writes code. Ideas are validated against competitors and market signals before they become issues.

Built for Claude Code. Also works with Cursor, Codex, OpenCode, and Gemini CLI.

> **Early release.** Strong on competitive research, customer evidence ingest, strategy, and grooming. Not yet focused on product analytics integration, A/B test planning, or several other things a PM does in a given week. If you have ideas for what should come next, open a [discussion](https://github.com/soelinmyat/pm/discussions).

---

## Installation

### Claude Code

```bash
claude plugin marketplace add https://github.com/soelinmyat/pm
claude plugin install pm@pm
```

### Cursor

Copy the `.cursor-plugin/` directory into your project root, or install via Cursor's plugin marketplace once published.

### Codex, OpenCode, Gemini CLI

These platforms do not have a one-line install. See the platform-specific guides:

- **Codex:** [`.codex/INSTALL.md`](.codex/INSTALL.md)
- **OpenCode:** [`.opencode/INSTALL.md`](.opencode/INSTALL.md)
- **Gemini CLI:** Clone the repo and add it to your Gemini extensions. See [`GEMINI.md`](GEMINI.md).

---

## Quick Start

The fastest path from zero to a groomed backlog:

```
/pm:setup
/pm:ingest ~/path/to/customer-evidence   # optional, if you already have support/interview/sales data
/pm:research landscape
/pm:strategy
/pm:research competitors
/pm:research <topic>
/pm:groom
```

**`/pm:setup`** configures your product context, target market, and integrations (Linear, SEO providers).

**`/pm:research landscape`** maps the competitive landscape: key players, categories, and whitespace in your market.

**`/pm:strategy`** synthesizes research into a positioning strategy. Defines your differentiated angle and strategic bets.

**`/pm:research competitors`** deep-dives on specific competitors. Tracks features, pricing, messaging, and recent moves.

**`/pm:research <topic>`** investigates a specific area — pricing models, API standards, regulatory requirements, or any question that needs grounded answers before building.

**`/pm:groom`** converts strategy and research into groomed Linear issues with acceptance criteria, effort estimates, and priority scores.

---

## Commands

| Command | Description |
|---------|-------------|
| `/pm:setup` | First-time configuration: product context, market, integrations |
| `/pm:ingest <path>` | Import customer evidence from local files or folders and update shared research artifacts |
| `/pm:strategy` | Generate and refine product positioning and strategic bets |
| `/pm:research <topic>` | Landscape mapping, competitor deep-dives, market signal analysis |
| `/pm:groom` | Convert strategy into groomed Linear issues ready for sprint |
| `/pm:dig <question>` | Quick inline research for mid-work decisions. No state, no issues. |
| `/pm:refresh [scope]` | Audit research for staleness and missing data, then patch without losing existing content |
| `/pm:view` | Open the knowledge base dashboard in your browser |

---

## Feedback

Ideas, bug reports, and workflow suggestions are welcome.

- Open an [issue](https://github.com/soelinmyat/pm/issues)
- Start a [discussion](https://github.com/soelinmyat/pm/discussions)

---

## License

MIT. Copyright (c) 2026 Soe Lin Myat. See [LICENSE](./LICENSE).
