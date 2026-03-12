# PM Plugin

A cross-platform AI plugin that gives Product Managers structured workflows for product discovery, competitive intelligence, and feature grooming. It turns raw ideas and market signals into well-researched strategies and ready-to-build Linear issues, all without leaving your editor.

---

## Installation

### Claude Code

```bash
claude plugin install https://github.com/soelinmyat/pm
```

Or add manually to your `CLAUDE.md`:

```markdown
## Plugins
- path: ~/Projects/pm
```

### Cursor

Copy the `.cursor-plugin/` directory into your project root, or install via Cursor's plugin marketplace once published.

### Codex (OpenAI)

```bash
codex plugin install https://github.com/soelinmyat/pm
```

### OpenCode

```bash
opencode plugin add https://github.com/soelinmyat/pm
```

### Gemini CLI

```bash
gemini plugin install https://github.com/soelinmyat/pm
```

---

## Quick Start

The bootstrap flow takes you from zero to a groomed backlog in four steps:

```
/pm:setup
```
First-time setup. Configures your product context, target market, and integrations (Linear, web search).

```
/pm:research landscape
```
Maps the competitive landscape. Identifies key players, categories, and whitespace in your market.

```
/pm:strategy
```
Synthesizes research into a positioning strategy. Defines your differentiated angle and strategic bets.

```
/pm:research competitors
```
Deep-dives on specific competitors. Tracks features, pricing, messaging, and recent moves.

```
/pm:groom
```
Converts strategy and research into groomed Linear issues with acceptance criteria, effort estimates, and priority scores.

---

## Skills Reference

| Skill | Command | Description |
|-------|---------|-------------|
| Setup | `/pm:setup` | First-time configuration: product context, market, integrations |
| Strategy | `/pm:strategy` | Generate and refine product positioning and strategic bets |
| Research | `/pm:research <topic>` | Landscape mapping, competitor deep-dives, user signal analysis |
| Groom | `/pm:groom` | Convert strategy into groomed Linear issues ready for sprint |
| Dig | `/pm:dig <question>` | Ad-hoc deep research on a specific question or topic |
| View | `/pm:view` | Browse and search accumulated research and strategy artifacts |

---

## License

MIT. Copyright (c) 2026 Soe Lin Myat. See [LICENSE](./LICENSE).
