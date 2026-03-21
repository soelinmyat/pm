# PM — Product Memory

A plugin for AI coding assistants that helps you figure out **what to build** and then **build it well**.

Most tools help you write code faster. PM helps you write the *right* code — by researching your market, tracking competitors, planning features, and then implementing them with structured workflows. Everything stays in your editor. Nothing gets lost.

Works with Claude Code, Cursor, Codex, and Gemini CLI.

---

## What It Does

**Think** — Research your market, study competitors, and build a product strategy. PM saves everything so it gets smarter over time.

**Plan** — Turn ideas into well-defined issues. Each idea goes through research, scoping, and multiple rounds of review before becoming a ticket.

**Build** — Implement features with test-driven development, automated code review, and PR workflows. If an issue was already planned through PM, the dev workflow skips redundant steps and goes straight to coding.

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

```
/pm:groom                    # turn an idea into ready-to-build issues
/pm:research landscape       # research your market
/pm:dev PM-001               # build a groomed issue end-to-end
```

That's the core loop: **groom it, research it, build it.**

> **Optional:** Run `/pm:setup` first to configure integrations (Linear, Ahrefs). PM works without it — setup just unlocks advanced features.

---

## All Commands

### Core Commands

| Command | What it does |
|---------|-------------|
| `/pm:groom` | Turn an idea into well-defined, ready-to-build issues — the primary PM entry point |
| `/pm:research <topic>` | Research a topic — competitors, market trends, anything |
| `/pm:dev` | Build a feature: plan, test, code, review, PR, merge |
| `/pm:dev-epic <id>` | Build a whole epic with parallel agents |

### Supporting Commands

| Command | What it does |
|---------|-------------|
| `/pm:setup` | Optional — configure integrations (Linear, Ahrefs) and bootstrap the knowledge base |
| `/pm:strategy` | Create or update your product strategy |
| `/pm:ideate` | Generate feature ideas based on your research and strategy |
| `/pm:dig <question>` | Quick research for a specific question |
| `/pm:ingest <path>` | Import customer feedback, interviews, or support data |
| `/pm:refresh` | Update stale research |
| `/pm:view` | Open the knowledge base dashboard |

### Building Commands

| Command | What it does |
|---------|-------------|
| `/pm:pr` | Push code and create a PR |
| `/pm:review` | Run a multi-perspective code review |
| `/pm:bug-fix` | Find and fix bugs in batch |
| `/pm:merge-watch` | Watch a PR and auto-merge when ready |
| `/pm:merge` | Merge a PR and clean up |

---

## How the Handoff Works

When you use `/pm:groom` to plan a feature, it goes through research, scoping, and review. The output includes detailed acceptance criteria and competitive context.

When you then use `/pm:dev` or `/pm:dev-epic` on that same feature, the dev workflow sees the grooming work and skips straight to implementation — no redundant brainstorming or spec review. The research context flows into the implementation plan automatically.

This is the main idea: **think once, build fast.**

---

## The `pm/` Directory

You'll notice a `pm/` folder in this repo. That's PM dogfooding itself — we use the plugin to manage its own development. When you install PM in your project, you'll get your own fresh `pm/` folder via `/pm:setup`.

---

## Feedback

- [Open an issue](https://github.com/soelinmyat/pm/issues)
- [Start a discussion](https://github.com/soelinmyat/pm/discussions)

## Acknowledgments

Inspired by [Superpowers](https://github.com/obra/superpowers), [Impeccable](https://github.com/pbakaus/impeccable), and [gstack](https://github.com/garrytan/gstack) (the multi-role virtual team approach).

## License

MIT. See [LICENSE](./LICENSE).
