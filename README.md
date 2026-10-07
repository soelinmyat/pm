# PM — Shared Product Brain for Small Teams

Opt-in ProductMemory native Dev uses a currently reviewed structured remote bundle and an already authorized host transport, with private local execution mechanics and unchanged canonical quality gates. It does not auto-configure credentials or enroll existing work. See [the native workflow contract](references/productmemory-native-workflow.md).

Small, explicitly assessed low-risk web UI changes use one combined visual/browser QA pass (desktop, narrow screen, and keyboard), followed by source review and release checks. Mobile, mixed-platform, larger, sensitive, or uncertain changes retain standalone design critique. No safety-bypass flag is needed.

Research, Ideate and Groom turn evidence into a customer/commercial recommendation: beneficiary, buyer (including unknown), user outcome, commercial hypothesis, contrary evidence, uncertainty, build/test-first/defer and a test that can reverse the decision. New Groom producers retain this as a cited `decision_brief.value_decision`; existing idea ranking stays unchanged. A valid structure authenticates references, not market truth.

Consequential app journeys can be groomed in an isolated consumer worktree using the real app shell, navigation and components with separate synthetic fixtures. `scripts/app-preview.js` binds exact source, reviewed UI code, fixtures, launch recipe and observed states, then checks adoption of that UI delta into an isolated Dev base. Inert document prototypes remain supported. Preserve the pinned source worktree until adoption; a preview identity is neither a source bundle nor backend certification.

Product approval may explicitly delegate technical derivation and implementation for the exact reviewed content. Independent RFC reviewers must preserve product, commercial, security, privacy and operational boundaries. The v4/v5 technical audits retain the original product decision and record reviewed derivation/maintenance; generated RFC bytes never become newly human-approved. Missing delegation keeps the existing initial RFC approval path. External and platform permissions remain separate.

Design Critique and Review recover within the same approved scope after their diagnosis thresholds, keeping immutable failed reports and continuous round counts. A grounded changed approach, fresh affected checks and a bounded resource budget replace count-only reapproval. Genuine decisions, disputes, missing dependencies and risk changes still stop with concrete evidence.

Product UI reviews start with the user's task and ordinary navigation, assess the composition independently before the implementation rationale, and compare a relevant sibling screen. Reviewers explain checkable usability claims and accepted tradeoffs; fixes get a bounded recheck of the affected journey. Evidence validation supports that judgment without treating report completeness or capture counts as proof of good UX. Reviewers personally inspect rendered desktop/narrow composition: field alignment, sizing and content growth, tab integration, spacing and hierarchy. A completed journey or shared-component compliance cannot certify those visual qualities.

Visible UI implementation starts with the relevant repository design guide and a strong comparable screen. The initial brief makes task hierarchy, disclosure, metadata and actions concrete, preserving the approved interaction and existing navigation. Before accepting the first hierarchy/interaction-changing slice, inspect realistic whole-page before/after composition within existing implementation work. This adds no review round or universal alternative prototype; unavailable pixels remain an explicit gap, and final critique/QA still certify current UI. See [implementation examples](skills/dev/references/product-ui-judgment.md#apply-during-implementation), including detail pages and drawers with manual Save.

Evidence helpers preserve source findings, counterevidence and prior analyst context. Linking or refreshing a source produces a traceable digest; changed sources leave conclusions pending synthesis rather than increasing confidence from file counts. Reasoning scores describe structural readiness, with evidence binding and semantic quality reported separately. Research distinguishes observed public behavior from inferred architecture or demand, and engineering examples use real outcome assertions rather than vacuous checks.

Permitted CUA observations can support a specific product journey with explicit provenance and capability limits. They do not currently produce the trusted schema-v2 capture bundle; unavailable native/network/build evidence and real-backend coverage remain unknown or blocked. See [capture guidance](skills/dev/references/design-critique-capture-guide.md).

Sparse loading captures can validate a native named heading and a separate visible loading indicator against their measured pixel regions. The full viewport image, ordinary density thresholds, atomic capture checks and offline pixel verification remain required.

Native capture hit-testing uses the visible input host rather than its browser-internal shadow nodes. Static text guards accept the exact containing element returned by native hit-testing; sibling and nested overlays remain failures. Keyboard audits recognize an unambiguous combobox controlling a separate listbox, including a single suggestion, only after native Tab and arrow events demonstrate access to its options. Broken handlers, static active-descendant markup and actual occluding elements remain failures.

Named modal evidence follows focus into a popup through one expanded native controls relationship; ambiguous and cyclic links cannot establish ownership even across intervening popup or modal wrappers, and a separate focused modal keeps its own context. Typography checks retain the modal's expanded popup content, including unfocused sibling popups, while geometry checks continue observing the whole viewport.

Product UI capture supports reserved scrollbar gutters without treating the smaller content area as a viewport mismatch. Screenshot dimensions, zoom, and capture identity checks still apply. Native design audits compare typography within related semantic regions and, while one named modal owns focus, within that modal rather than its inactive background. They also accept localized state changes with meaningful changed tiles, and compare native-measured error alerts when shared page chrome obscures an error/empty content difference. Duplicate images, pixel beacons, and genuine accessibility defects still fail. Interactive consistency comparisons also separate focused controls using native accessibility focus, while differences among unfocused peers remain findings.

Small keyboard-focus indicators are compared within bounded outline or outer-shadow bands when viewport-wide averaging misses them. This fallback requires native Tab input, an observed indicator-style change, matching viewport geometry, and material changes on at least two bands. Unchanged screenshots, control-interior noise, adjacent noise, and untrusted captures do not qualify. It does not replace the visual accessibility review.

Native iOS design critique can retain Maestro hierarchy observations with a capture-bound scope of changed controls. It checks measured labels, enabled states, and visible touch-target geometry without fabricating browser landmarks or tab order. VoiceOver traversal, semantics, occlusion, and focus still need separate observation. Maestro commands also qualify as native UI-automation QA receipts when the existing output and assertion bindings pass. Repeated native controls can use predeclared observed occurrences; changed noninteractive states require an explicit source-reviewed scope and produce only screen-geometry evidence, never vacuous name or touch-target passes.

Verified corrections within an already-approved Dev task do not need repeated approval: behavioral fixes require red/green regression evidence and fresh review. New scope, consequential decisions, disputes and external actions retain their approval boundaries.

QA does not stop or request permission merely after three rounds. It diagnoses persistent product, harness or evidence failures, changes the scoped recovery approach and continues with immutable round history. Genuine unresolved dependencies, product decisions and material scope/risk changes remain explicit boundaries.


When reviewers recommend the same fix in different words, they can explicitly confirm a common remedy without replacing their original findings. Every affected reviewer must agree; incomplete or conflicting clarification remains blocked, and no finding is dismissed by that agreement.

Release and Review can use the original Dev session across registered Git worktrees. The source worktree keeps its own evidence and release transaction; the session is not copied. Repository, namespace, branch and assigned-worktree checks prevent an unrelated session from authorizing delivery.

[![CI](https://github.com/soelinmyat/pm/actions/workflows/ci.yml/badge.svg)](https://github.com/soelinmyat/pm/actions/workflows/ci.yml)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/soelinmyat/pm)](https://github.com/soelinmyat/pm/releases)

PM is a free, open-source plugin for Claude Code, Codex, and OpenCode V2 (interactive workflows). It keeps market research, strategy, competitor context, groomed work, and delivery state in one place inside the repo — context that compounds over time, not another doc that decays after the meeting.

Quality gates focus on consequential task, data, access and evidence failures. QA finding indexes and Design Critique scores remain visible diagnostics; minor concerns use contextual judgment. Source Review publishes canonical JSON without requiring browser-rendered reports. Actual core-journey UX, source identity, required assertions and product/security/privacy authority retain their gates.

## Why PM?

Product context decays. The research doc goes stale, the strategy deck is six months old, and nobody remembers why you decided against that feature.

PM fixes this by making product knowledge **durable** and **wired into your workflow**:

- Every `/pm:dev` session builds on prior `/pm:research` and `/pm:groom` — context compounds instead of decaying
- Research, strategy, and competitive intel live in your repo, not in a separate tool nobody opens
- Evidence flows into insights, insights inform strategy, strategy gates grooming, grooming gates dev

Built for teams where roles blur. The engineer makes product calls. The PM ships minor features. The designer reviews implementation. The biz lead needs context without asking for updates.

Loading-state visual captures can retain genuine outstanding read-only Fetch/XHR
requests. The helper records those requests in its evidence and keeps origin,
visibility, and atomic stability checks enabled.

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

Think-to-Groom handoff preserves approved proposal identity even when the selected Think direction has a different slug. Promotion still verifies exact approval and source lineage; generated `proposal:<slug>` reader IDs are accepted by KB validation when their filename, kind, and proposal link match.

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

Use one current PM installation. The read-only `scripts/pm-installations.js`
diagnostic reports fallback/native versions, duplicate workflows, and skill
hashes. Its explicit migration command moves verified fallback symlinks into a
private backup with a restore receipt; it preserves unrelated skills. See the
installation guide for migration and rollback commands.

For a consistent model choice across Dev, Groom, RFC, and Review, save an
explicit [execution policy](references/execution-policy.md). Named profile
overrides and existing sessions keep their choices; inline work inherits the
host agent. No policy grants additional authority.

PM loads current workflow instructions as needed and continues authorized
drafting without routine confirmation pauses. Genuine product decisions and
approval records remain explicit. Dev and Groom prompt packets reject excess
content against configurable budgets rather than silently truncating contracts.

Simple generated Review reports use current browser checks at three widths and
a desktop capture. Rich reports, presentation changes, and unsupported evidence
use the full responsive/print route. Workspace verification plans reuse only
matching source/environment/dependency evidence and preserve required final
checks. Structural proposal scores are explicitly labeled; semantic judgment
still requires evidence-based review.

Review targets retain immutable copies of their upstream design report. If an older target references a canonical report that has since advanced, PM can recover an archived original only when its hash, commit and outcome match exactly, preserving the historical target and recording the recovery separately.

The [quality evaluation suite](evals/README.md) covers daily Research, Think,
Strategy, and Ideate work as well as delivery workflows. It reports observed
efficiency data and leaves unavailable measurements unknown. No general Astra
quality or speed advantage is claimed without comparable live runs.

### Other platforms

PM supports Claude Code, Codex, and OpenCode V2 interactive workflows. OpenCode installation, supported capabilities, and headless limitations are documented in [`.opencode/INSTALL.md`](.opencode/INSTALL.md). Community contributions for other platforms are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

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
| `/pm:groom [idea]` | Build a resumable, evidence-backed product proposal with canonical JSON, responsive HTML/Markdown readers, a visible source-bound prototype entry point when UI exploration is warranted and approved, quality calibration, and explicit hash-bound approval |
| `/pm:ideate` | Mine evidence-backed ideas, rank them deterministically, and flag strategy conflicts |

### Development and delivery

| Command | What it does |
|---|---|
| `/pm:task <title>` | Capture a lightweight chore (version bump, small cleanup) — skips groom/RFC, feeds straight into `/pm:dev` |
| `/pm:bug <title>` | File a bug report with observed/expected/reproduction stubs — skips groom/RFC, feeds straight into `/pm:dev` |
| `/pm:rfc <feature-slug>` | Generate or maintain a technical RFC; reviewed in-scope execution corrections retain the original approval |
| `/pm:dev [ticket]` | Routes by canonical proposal scope and observed risk, resumes phase-local state, implements with TDD, and verifies delivery evidence |
| `/pm:design-critique` | Review product UI or PM HTML artifacts with trusted state/viewport captures (including bounded native keyboard navigation and below-fold scrolling), decoded-pixel and accessibility evidence, separately recorded Primary and Fresh Eyes perspectives with workflow-attested isolation, explicit reconciliation, and an accessible commit-bound report |
| `/pm:review` | Run evidence-bound source review with six baseline lenses plus risk-triggered security, disagreement handling, bounded fix rounds, and canonical JSON; routine clean source reviews need no browser, while complex/risky reviews retain checked HTML |
| `/pm:ship [PR]` | Prepare the final tree, bind the reviewed PR body through creation and a fresh pre-merge attestation, then resumably push, monitor CI, merge, and place any release tag on the verified main SHA |
| `/pm:loop status` | Show the git-backed loop board and scheduler-safe orchestration; unattended stages use validated stage results and park contract or approval failures at non-dispatchable `needs-human` |
| `/pm:loop reconcile` | Dry-run stale-card classification from durable run/recovery and repository-pinned PR evidence; `--apply` requires Git readiness and isolated PM transactions |
| `/pm:board` | Open a visual Kanban view of backlog, leases, recent runs, and budget state |
| `/pm:list` | Show the same in-flight PM state as a compact terminal-oriented inventory |

PM automatically discovers repository-native delivery capabilities and chooses
the safest supported route with zero consumer edits. An optimized review-first
route requires an explicitly authorized machine-readable candidate-publication
policy; otherwise PM retains comprehensive Review → Push → PR → CI behavior.
CleanLog's current contract therefore gets repository-native planning and
guidance but stays comprehensive. Set `PM_DELIVERY_COMPREHENSIVE=1` as the
single kill switch to force comprehensive delivery; capability guidance is
read-only and setup changes require separate explicit authority.

Groom and RFC artifact work is isolated from the shared knowledge-base checkout. Each
session uses a dedicated `codex/` worktree created from the Git remote's observed
default branch, fetched from that same delivery URL, so an unrelated dirty session or
feature branch cannot be swept into the proposal or RFC commit. Product-source identity
and private workflow state remain anchored to the consumer repository while proposal and
RFC artifacts are bound to the isolated knowledge-base worktree. Existing unowned branch
collisions stop for manual recovery instead of being reused or published. Fresh RFC
intake rejects omitted or unowned artifact roots, and resumed Groom work revalidates its
recorded helper branch and delivery URL before proceeding. RFC work inherits only a
clean, approval-audit-verified proposal from the matching Groom artifact branch, safely
fast-forwarding an otherwise-unused early RFC worktree when necessary, then revalidates
its own helper-owned branch on resume. Branch names always append the workflow kind to
the complete session slug, preventing suffix-like slugs from aliasing another session.

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

Git sync setup preserves pending edits in an existing KB repository. A successful
setup verifies its upstream; run `/pm:sync` afterward to pull, commit, and publish
those edits.

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

Design capture follows real keyboard focus, including asynchronous roving tab controls. It restores URL-backed tabs through their native handlers and requires the original URL afterward. Typography consistency is compared within semantic page regions.

### Reading generated artifacts

Proposal and RFC HTML readers use section/subsection navigation, short decision-first prose, and expandable execution detail. Proposals place source-bound prototype links before implementation detail; absent prototypes are labeled honestly. Risks and pending decisions remain visible, and complete evidence and execution contracts remain available for review and printing.

ProductMemory shared projects can use the credential-free Codex MCP host for
remote-first Groom/RFC publication and native development. See
[the host protocol and approval boundaries](references/productmemory-codex-host.md).
Private runtime state stays local; connecting MCP and writer cutover remain
separate user-coordinated steps.

### Evidence reuse and sync receipts

PM separates retained feature review from integration checks when main advances. `scripts/review-impact.js` reports changed upstream paths against an explicitly complete dependency/contract closure; unknown coverage requires full validation. The report is advisory, while the existing review freshness checker and exact-head CI remain delivery gates. Identical workflow grants reuse their audit; material changes and platform permissions retain their own approval requirements.

QA preflights fixtures, selectors, capture names, build setup and simulator ownership, and distinguishes harness failures from product assertions. Report formatting repairs preserve acceptance evidence only when its source and run bindings remain valid. Git KB sync records a live remote acknowledgement and blocks pull with staged changes to preserve staged and working variants. Missing upstream, mixed ownership, conflicts and unavailable remotes stay explicit blockers.

Browser-dependent work uses the [method and evidence preflight](references/browser-evidence-preflight.md) to choose permitted collectors early, preserve bounded method context for unchanged retries, and state missing coverage. Platform authorization remains authoritative; supplemental observations do not replace certifying capture contracts.
