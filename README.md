# PM — Product Memory

PM is a free, open-source plugin that gives small squads using AI coding assistants such as Claude Code and Codex a shared product brain. It keeps market research, strategy, competitor context, groomed work, and delivery state in one place inside the repo.

PM is built for teams where roles blur. The engineer makes product calls. The PM ships minor features. The designer reviews implementation. The biz lead wants to know what is happening without asking for updates. PM keeps everyone working from the same context.

Built for Claude Code and Codex.

> **Early release.** PM already works well for research, strategy, grooming, and disciplined shipping. The dashboard and collaboration layer are still being polished.

## Install PM

#### Claude Code

```bash
claude plugin marketplace add soelinmyat/pm
claude plugin install pm@pm
```

#### Codex

PM ships a native Codex plugin manifest at `.codex-plugin/plugin.json`.

When Codex loads PM as a native plugin, the skills appear under the plugin namespace as
`pm:groom`, `pm:research`, `pm:strategy`, `pm:ingest`, and `pm:refresh`.
If your Codex build is still using the fallback symlink install, PM creates `pm-*` and `dev-*`
alias directories under `~/.agents/skills`, but fresh Codex sessions still surface the usable
skills as `pm:*` names such as `pm:groom` and `pm:dev`.

If your Codex install is not loading the plugin directly yet, use the fallback install steps in [`.codex/INSTALL.md`](.codex/INSTALL.md).

## Run Your First Workflow

If your client supports slash commands:

```text
/pm:setup
/pm:research landscape
/pm:strategy
/pm:groom "feature idea"
```

If you are using Codex fallback explicit-skill aliases:

```text
$pm-setup
$pm-research landscape
$pm-strategy
$pm-groom "feature idea"
```

If you already have support tickets, interview notes, or sales call notes, ingest them before research:

```text
/pm:ingest ~/path/to/customer-evidence
```

If you are collaborating across machines or a shared PM server, check sync status before you continue work:

```text
/pm:sync status
```

## What You Will Get

After onboarding, PM gives you:

- a committed `pm/` knowledge base for strategy, research, competitors, proposals, and backlog context
- a private `.pm/` runtime folder for config, evidence, sessions, local state, and sync status
- automatic metadata validation on PM artifacts so malformed files are caught early
- knowledge base sync workflows for shared PM state across machines
- a dashboard view so non-engineering teammates can see the current state without digging through files
- workflows that reuse the same context for both product thinking and implementation

---

## What PM Is Good At

- **Research before building.** Market landscape, competitor profiles, and focused topic research.
- **Turning ideas into strategy.** PM writes and updates product strategy so decisions stay aligned with ICP, positioning, priorities, and non-goals.
- **Turning strategy into work.** PM grooms ideas into structured issues, proposals, and supporting artifacts.
- **Carrying context into delivery.** PM supports development, review, QA, ship, deploy, and merge workflows so the why does not get lost after grooming.
- **Keeping the whole squad aligned.** The dashboard reflects the same knowledge base the editor workflows write to.

---

## Who PM Is For

PM is a strong fit if you are:

- a product engineer or technical founder who both decides and builds
- a small squad that wants research, strategy, and implementation context in one system
- a team already using Linear or Jira for execution but missing an upstream thinking layer

PM is not trying to replace project management tools. Linear and Jira still handle assignments, sprints, and team execution. PM handles the thinking layer: what to build, why it matters, and how that context carries through the work.

---

## What PM Creates In Your Repo

PM writes committed product context to `pm/` and runtime state to `.pm/`.

```text
pm/
  strategy.md
  landscape.md
  competitors/
  research/
  backlog/

.pm/
  config.json
  evidence/
  imports/
  sessions/
  dev-sessions/
```

In practice:

- `pm/` is the durable product memory you usually want in git
- `.pm/` is runtime state, integration config, and session data you usually do not want in git

---

## Core Commands

### Command-based clients

| Command | What it does |
|---|---|
| `/pm:setup` | Bootstrap the knowledge base and configure integrations |
| `/pm:ingest <path>` | Import customer evidence from files or folders |
| `/pm:research <topic>` | Research a landscape, competitors, or a focused topic |
| `/pm:strategy` | Create or update the product strategy document |
| `/pm:groom [idea]` | Turn an idea into scoped, reviewable work |
| `/pm:refresh [scope]` | Audit research for staleness and patch gaps |
| `/pm:sync [push\|pull\|status]` | Manually inspect or move PM knowledge base changes |
| `/pm:ship` | Review, push, create PR, monitor CI, and merge |

### Codex

On Codex, the fallback install creates `pm-*` and `dev-*` alias directories on disk, but fresh
sessions expose the user-facing PM workflows under the `pm:*` namespace.

Common examples:

- `pm:groom`
- `pm:dev`
- `pm:review`
- `pm:qa`

See [`.codex/INSTALL.md`](.codex/INSTALL.md) for the exact install flow and current skill names.

---

## How PM Fits Into A Team

PM is the shared product brain for small squads:

- Engineers use it in the editor
- PMs and biz teammates use the dashboard for context
- Designers use it to review proposals and implementation against the original intent

The point is not just better prompts. The point is persistent context that compounds over time.

---

## What PM Is Not

- Not a project management tool
- Not a standalone analytics product
- Not an enterprise workflow suite

PM is free, open-source, and designed for bottom-up adoption by small squads.

---

## Feedback

- Open an [issue](https://github.com/soelinmyat/pm/issues)
- Start a [discussion](https://github.com/soelinmyat/pm/discussions)

---

## License

MIT. Copyright (c) 2026 Soe Lin Myat. See [LICENSE](./LICENSE).
