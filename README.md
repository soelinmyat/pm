# PM — Shared Product Brain for Small Teams

[![CI](https://github.com/soelinmyat/pm/actions/workflows/ci.yml/badge.svg)](https://github.com/soelinmyat/pm/actions/workflows/ci.yml)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/soelinmyat/pm)](https://github.com/soelinmyat/pm/releases)

PM is a free, open-source plugin for Claude Code and Codex. It keeps market research, strategy, competitor context, groomed work, and delivery state in one place inside the repo — context that compounds over time, not another doc that decays after the meeting.

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
/pm:think "should we add team filtering to the dashboard?"
```

That's it. PM challenges your assumptions, explores tradeoffs, and captures the thinking as a durable artifact. No setup required.

When you're ready to go deeper:

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
    provenance.json            # portable Evidence-ID ledger and revision history
    research/                  # market landscape, topic research
    competitors/               # competitor profiles and intel
    transcripts/               # ingested interview/call transcripts
    user-feedback/             # ingested customer evidence
    notes/                     # quick-captured observations and signals
  insights/                    # synthesized product and business insights
  backlog/                     # proposals, RFCs, wireframes
    proposals/                 # groomed product proposals
    rfcs/                      # implementation plans (HTML)
    wireframes/                # design wireframes
  thinking/                    # pre-commitment exploration artifacts
  product/
    features.md                # feature inventory

.pm/
  config.json                  # integration config (Linear, Ahrefs)
  evidence/                    # private normalized records, requests, conflicts
  dev-sessions/                # active dev session state
  groom-sessions/              # active groom session state
  rfc-sessions/                # active RFC session state
  workflows/                   # user step overrides
```

`pm/` is the durable product memory — commit it. `.pm/` is runtime state — gitignore it.

### Example output

A backlog entry after grooming:

```yaml
---
type: backlog
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

A research finding (reader Markdown stays concise; the ledger carries portable hashes, privacy state, revisions, and artifact bindings):

```yaml
---
type: evidence
evidence_type: research
topic: Dashboard Filtering
source_origin: external
provenance_version: 2
created: 2026-04-01
updated: 2026-04-01
sources:
  - url: "https://example.com/analytics-trends"
    title: "Analytics Dashboard Trends 2026"
---

## Findings

- Teams repeatedly narrow shared dashboards by ownership. [evidence:ev_0123456789abcdef01234567]
- Hypothesis: saved team views will reduce repeated filter setup. [evidence:ev_0123456789abcdef01234567]
```

Evidence v2 keeps raw customer inputs and machine-local paths under `.pm/`. `/pm:note`, `/pm:ingest`, and `/pm:research` publish stable Evidence-IDs into `pm/evidence/provenance.json`; changed sources retain revision history, and `/pm:refresh` rejects stale ledger or artifact snapshots instead of overwriting newer work. Legacy research remains readable and upgrades incrementally when touched.

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

See the [workflow map](docs/workflow-map.md) for routing from evidence through delivery,
and the [artifact gallery](docs/artifact-gallery.md) for the source, reader, validation,
and rendered-evidence contract behind PM's flagship reports.

### Product discovery

| Command | What it does |
|---|---|
| `/pm:start` | Bootstrap the knowledge base or resume where you left off |
| `/pm:think` | Structured product thinking with a traceable decision brief and verified promotion |
| `/pm:research <topic>` | Source-register market landscape, competitor profiles, or claim-level cited topic research |
| `/pm:strategy` | Create or update strategy plus stable priority/non-goal tokens for downstream checks |
| `/pm:groom [idea]` | Build a resumable, evidence-backed product proposal with canonical JSON, generated HTML/Markdown readers, quality calibration, and explicit hash-bound approval |
| `/pm:ideate` | Mine evidence-backed ideas, rank them deterministically, and flag strategy conflicts |

### Development and delivery

| Command | What it does |
|---|---|
| `/pm:task <title>` | Capture a lightweight chore (version bump, small cleanup) — skips groom/RFC, feeds straight into `/pm:dev` |
| `/pm:bug <title>` | File a bug report with observed/expected/reproduction stubs — skips groom/RFC, feeds straight into `/pm:dev` |
| `/pm:rfc <feature-slug>` | Generate a technical RFC from the trusted execution contract of an approved groomed proposal |
| `/pm:dev [ticket]` | Routes by canonical proposal scope and observed risk, resumes phase-local state, implements with TDD, and verifies delivery evidence |
| `/pm:design-critique` | Review product UI or PM HTML artifacts with commit-bound captures, accessibility/viewport/print evidence, structured findings, and an accessible report |
| `/pm:review` | Run evidence-bound source review with adaptive six-lens coverage, disagreement handling, bounded fix rounds, and a checked HTML report |
| `/pm:ship [PR]` | Prepare the final tree, review it, and resumably push, reconcile/create a PR, monitor CI, merge, and place any release tag on the verified main SHA |
| `/pm:loop status` | Show the git-backed loop board and scheduler-safe orchestration; unattended stages use validated stage results and park contract or approval failures at non-dispatchable `needs-human` |
| `/pm:loop reconcile` | Dry-run stale-card classification from durable run/recovery and repository-pinned PR evidence; `--apply` requires Git readiness and isolated PM transactions |
| `/pm:board` | Open a visual Kanban view of backlog, leases, recent runs, and budget state |
| `/pm:list` | Show the same in-flight PM state as a compact terminal-oriented inventory |

### Supervised loop rollout

Keep the scheduler paused or uninstalled while validating a new loop runtime. Run all
three cases against the same plugin version, source commit, resolved config, and engine:

Set `CLEANLOG_ROOT` to the absolute consumer project root. Set `CANARY_CARD` to an
eligible approved card that is expected to produce an OPEN PR, then run the exact
commands from the installed PM plugin root:

```bash
export PM_PLUGIN_ROOT=/absolute/path/to/installed/pm
cd "$PM_PLUGIN_ROOT"
```

```bash
node scripts/loop-canary.js --project-dir "$CLEANLOG_ROOT" --case preflight-failure
node scripts/loop-canary.js --project-dir "$CLEANLOG_ROOT" --case blocked-result
node scripts/loop-canary.js --project-dir "$CLEANLOG_ROOT" --case verified-pr --card "$CANARY_CARD" --no-merge
```

Evidence is written under `.pm/loop-canary/<run_id>/<case>.json`. Installation and
resume fail closed when evidence is missing, stale, mixed across identities, or failed.
Gate-owned scheduler entries mark every unattended wake with `--scheduled`; the worker
rechecks current same-identity evidence before any claim, so stale or changed runtime
identity cannot keep dispatching unattended work. Generated assets are previews only.
The canary never merges: `autonomy.merge_pr` must remain `false`.
Unmarked worker CLI invocations also default to scheduler-safe gating for legacy
scheduler entries; an explicitly supervised one-off worker run uses `--manual`.

Run ledgers record structured token usage when the engine exposes it and
`usage_available: false` when it does not; PM never invents usage numbers and does not
support exact token cutoffs for engines without stable structured usage. Repeated exact
card/stage/blocker signatures are parked at `needs-human` before another engine launch.
An in-flight STOP sends TERM to the engine process group, then KILL after the configured
shutdown grace, with timestamps and signals persisted in the ledger and durable event.

### Knowledge base management

| Command | What it does |
|---|---|
| `/pm:features` | Write `features.md` plus a stable, source-bound `features.json` inventory |
| `/pm:ingest <path>` | Normalize customer evidence privately and publish portable, ledger-backed findings |
| `/pm:note` | Atomically capture a product signal with a stable Evidence-ID |
| `/pm:refresh [scope]` | Audit exact source freshness and conflict-safe patch stale research |
| `/pm:setup` | Enable or disable integrations (Linear, Ahrefs) |
| `/pm:sync [pull\|push\|status]` | Bidirectionally synchronize the git-backed PM knowledge base, with explicit one-way and inspection modes |

Compatibility: deprecated `/pm:simplify` redirects to `/pm:review`; Review owns its
reuse, quality, and efficiency lenses, so Simplify is not a separate workflow or gate.

## How PM Fits a Team

- **Engineers** use it in the editor — research, groom, build, ship
- **PMs and biz leads** use the knowledge base for strategy, research, and roadmap context
- **Designers** review proposals and implementation against the original intent

The knowledge base is the shared context. Everyone works from the same research, strategy, and decisions.

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for how the plugin works at runtime — skill loading, step execution, agent dispatch, and state management.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to add platform support, create commands and skills, run tests, and submit PRs.

## Feedback

- Open an [issue](https://github.com/soelinmyat/pm/issues)
- Start a [discussion](https://github.com/soelinmyat/pm/discussions)

## License

MIT. Copyright (c) 2026 Soe Lin Myat. See [LICENSE](./LICENSE).
