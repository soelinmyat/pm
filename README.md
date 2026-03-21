# PM — Product Memory

A plugin for AI coding assistants that helps you figure out **what to build** and then **build it well**.

Most tools help you write code faster. PM helps you write the *right* code — by researching your market, tracking competitors, planning features, and then implementing them with structured workflows. Everything stays in your editor. Nothing gets lost.

Works with Claude Code, Cursor, Codex, and Gemini CLI.

PM activates the right workflow automatically — no commands to memorize.

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

**Start with what you want to build.** Tell PM your feature idea and it will research the market, scope the work, and produce ready-to-build issues — all in one conversation.

**Or start with what you want to learn.** Ask PM to research a topic, map competitors, or analyze your market. The research accumulates in your knowledge base and informs future planning.

Everything else — setup, strategy, ideation, ingestion — happens on-demand when the workflow needs it. You don't need to memorize anything.

---

## What You Can Do

### Think

- **Research** a topic, competitor, or market trend
- **Build a strategy** with product positioning and strategic bets
- **Generate ideas** based on your research and strategy
- **Groom** an idea through research, scoping, and review into ready-to-build issues
- **Dig** into a specific question for quick answers
- **Import** customer feedback, interviews, or support data
- **Refresh** stale research without losing existing content
- **Browse** your knowledge base in a local dashboard

### Build

- **Develop** a feature end-to-end: plan, test, code, review, PR
- **Run an epic** with multiple related issues in parallel
- **Review** code from multiple perspectives
- **Create a PR** with summary and test plan
- **Fix bugs** in batch with structured triage
- **Watch a PR** and auto-merge when checks pass

---

## How the Handoff Works

When you groom a feature, PM takes it through research, scoping, and review. The output includes detailed acceptance criteria and competitive context.

When you then build that same feature, the dev workflow sees the grooming work and skips straight to implementation — no redundant brainstorming or spec review. The research context flows into the implementation plan automatically.

This is the main idea: **think once, build fast.**

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
