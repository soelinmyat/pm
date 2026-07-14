---
title: "PM plugin master plan"
created: 2026-07-13
updated: 2026-07-13
status: active
owners:
  - pm-plugin
---

# PM plugin master plan

## Outcome

Make the entire PM plugin reliable and high-quality on GPT-5.6 Sol High and Opus 4.8 xHigh without turning every workflow into a large ceremony. Deterministic mechanics belong in scripts and schemas; model judgment belongs in bounded phase prompts; human-facing artifacts must be readable, traceable, and deliberately rendered.

Completion means every shipped skill has an explicit contract, proportionate evaluation coverage, safe state/effect handling, and a defined artifact policy. It does not mean every skill needs a state machine, HTML report, multi-agent fan-out, or full live-model matrix.

## Current release map

| Release | Capability | State |
|---|---|---|
| v1.13.10 | Model-adaptive, evidence-driven `pm:dev` | Released |
| v1.13.11 | Phase-local, approval-safe `pm:rfc` | Released |
| v1.13.12 | Shared HTML artifact foundation | Released |
| v1.13.13 | Blind output-quality evaluation harness | Released |
| v1.13.14 | Evidence-bound `pm:design-critique` | Released |
| v1.13.15 / Wave 3B | Evidence-bound adaptive `pm:review` | Released |
| v1.13.17 / Wave 4A | Executable skill-authoring contract and audit | Released |
| v1.13.25 / Wave 4B | Shared provider-neutral workflow runtime primitives | Released |
| vNext / Wave 5 | Groom v2, canonical proposal contract, and quality calibration | Certified; release PR pending |

Wave 5 is certified and awaiting its release merge. Wave 6 is next and begins from the reviewed Wave 5 commit after it lands on main.

## Operating laws

1. **One decision has one bounded review lineage.** A lineage has at most three remediation rounds. Renaming a run never resets that budget. A passing round ends review; P2/P3 debt stays visible without forcing another round.
2. **Prepare release metadata before final review.** The version commit must be inside the frozen review target. Tagging happens only on the main merge commit. This prevents the patch bump from invalidating otherwise-current delivery evidence.
3. **Scripts decide facts; models exercise judgment.** State transitions, hashes, paths, authority, retries, identity, schema validation, and effect replay are deterministic. Prioritization, synthesis, critique, and trade-offs remain model work.
4. **JSON is the machine contract; the best reader format is the human contract.** Use HTML for rich, navigable, printable reports; Markdown for durable text; terminal output for quick status; do not create HTML merely to satisfy a pattern.
5. **External effects are root-owned and receipt-backed.** Push, PR, merge, tracker, scheduler, integration, and knowledge-base mutations require explicit authority and idempotent effect records.
6. **Evaluation depth follows risk.** Core lifecycle skills receive the full scenario matrix. Supporting skills receive deterministic contracts, representative fixtures, and targeted quality cases. Capture aliases do not get six-model certification suites.
7. **Source, cache, and release are separate states.** Edit source, sync both workhorse caches, verify the installed copies, then release through a PR. Never patch installed cache code directly.

## Completion contract

The master plan is complete only when all of the following are evidenced on main:

- Every non-deprecated `skills/*/SKILL.md` satisfies the repository authoring contract or declares a validator-recognized, narrow exemption.
- Every procedural step has Goal, How, Done-when, and an explicit transition; conversational single-file skills have equivalent decision and exit criteria.
- Command descriptions, skill triggers, runtime behavior, public docs, and examples resolve to the same workflow semantics.
- Shared runtime primitives are reused without creating a generic workflow engine or erasing skill-specific policy.
- Every durable artifact type appears in the artifact matrix below and passes its declared structural, content, and render gates.
- Core workflows pass all committed behavioral and quality cases; supporting workflows pass their declared contract fixtures.
- Sol High and Opus xHigh can execute the same provider-neutral contracts, with capability downgrades recorded rather than inferred.
- Both installed plugin caches pass plugin validation and their representative smoke suites.
- Every release PR passes hosted CI, merges to main, and has its version tag on the main merge commit.
- No open P0/P1, unresolved reviewer dispute, or unowned deferred P2 remains.

## Whole-plugin inventory and destination

| Cluster | Skills | Target |
|---|---|---|
| Session routing | `using-pm`, `start`, `list`, `board` | One read model for active work; concise routing; terminal and browser views generated from the same state |
| Product reasoning | `think`, `ideate`, `strategy`, `features` | Structured decisions and evidence references with lightweight human Markdown; no forced lifecycle runner |
| Evidence | `note`, `ingest`, `research`, `refresh` | Shared evidence identity, provenance, staleness, and writeback contracts; preserve source-specific judgment |
| Definition | `groom`, `rfc` | Structured proposal/RFC sources, phase-local execution, explicit approval, high-quality reader artifacts |
| Delivery | `dev`, `design-critique`, `review`, `ship` | One evidence chain from implementation through rendered quality, source review, release transaction, and external receipts |
| Operations | `setup`, `sync`, `loop` | Explicit effect plans, authority checks, idempotent receipts, recovery-safe resume |
| Capture | `task`, `bug` | One atomic backlog capture primitive with alias-specific defaults and routing |
| Compatibility | `simplify` | Thin, tested redirect to Review; no independent gate or duplicated instructions |

## Artifact matrix

| Artifact | Machine source | Human form | Required gates |
|---|---|---|---|
| Proposal | Structured proposal JSON | Accessible offline HTML; concise execution contract | Schema, source binding, artifact check, rendered critique for material template changes |
| RFC | RFC sidecar plus approval audit | Accessible offline HTML | Sidecar check, lifecycle/hash binding, artifact check, explicit approval |
| Review | Frozen target/results/decisions/report JSON | Responsive printable HTML | Review checker, retained render manifest, browser-visible decision markers |
| Design Critique | Route/capture/report JSON | Responsive printable HTML | Evidence checker, source/capture hashes, accessibility, viewport and print coverage |
| Quality scorecard | Candidate/judgment/aggregate JSON | Markdown scorecard | Behavioral precedence, blinded identity, rubric validation, variance disclosure |
| Research/evidence | Evidence records and provenance manifest | Markdown research and summaries | Source identity, citations, freshness, merge/writeback validation |
| Strategy/features | Structured decisions or inventory JSON | Markdown strategy/inventory | Evidence references, internal consistency, deterministic regeneration |
| Operational status | Canonical session/loop/backlog state | Terminal list or local board HTML | Read-only projection, sanitization, consistency across views |
| Delivery receipt | Effect journal JSON | Concise terminal/PR summary | Authority, exact target identity, idempotency, remote verification |

## Delivery sequence

### Wave 3B — Review quality gate

**State:** implemented and locally verified on `codex/review-quality-gate`.

Land the adaptive six-lens evidence contract, immutable review rounds, strict synthesis, browser-verified report, and non-resettable remediation budget. Preserve the two non-blocking medium findings as owned follow-up debt rather than reopening review:

- attest an already-installed atomic output after a child crashes between installation and receipt serialization;
- make historical nested-prior validation available through the documented Review CLI path while keeping current-report version checks strict.

The terminal release pass covered all six lenses with zero blockers or disputes. The exact `v1.13.15` source commit passed 1,800 tests with zero failures and one intentional skip; both installed workhorse caches passed plugin validation and a 91-test Review smoke suite.

**Exit:** patch release on main, both workhorse caches verified, CI green, tag moved to the main merge commit.

### Wave 4A — Authoring contract and plugin-wide audit

**State:** released as v1.13.17 through PR #353.

Turn the authoring rules in `AGENTS.md` into executable plugin validation:

- validate required SKILL sections, runtime/writing directives, trigger-rich descriptions, and bounded SKILL size;
- validate Goal/How/Done-when/Advance semantics for procedural steps;
- support explicit narrow exemptions for redirects and output-free utilities;
- validate command-to-skill parity and public-example parity;
- emit a machine-readable audit plus a readable summary grouped by skill and severity.

Then remediate the plugin in small clusters. Do not make one 24-skill rewrite. Preserve working domain guidance while extracting duplicated procedure.

**Exit:** validator fails on representative thin/misaligned fixtures; every shipped skill either passes or has a justified coded exemption; no behavior change is claimed from prose-only presence tests.

### Wave 4B — Shared runtime primitives

**State:** released as v1.13.25 through PR #354.

Extract only the stable boundaries already proven by Dev, RFC, Review, and Design Critique:

- descriptor-bound project input and atomic project output;
- canonical state/result envelopes and transition history;
- evidence bindings, commit identity, and recertification records;
- phase-local step resolution and prompt packets;
- model profiles, capability probes, runtime requests, and structured results;
- authority envelopes and external-effect receipts.

Keep routing tables, approval policy, findings, artifact schemas, and gate rules inside their owning skills. A generic workflow engine remains a non-goal.

**Exit:** existing lifecycle suites pass against shared primitives; duplicated implementations are removed; legacy migration/resume fixtures remain green; prompt and result bytes stay provider-neutral.

### Wave 5 — Groom v2 and proposal quality

**State:** implementation, remediation, and certification complete on `codex/groom-v2`; release PR pending. Detailed plan in `docs/plans/2026-07-14-groom-v2-wave-5.md`.

Make Groom the next full lifecycle migration:

- phase-local research, scope, synthesis, design, draft, review, and presentation;
- independent-question fan-out instead of fixed reviewer counts;
- structured product decisions, assumptions, evidence, acceptance criteria, non-goals, and design requirements;
- one structured proposal source that generates the HTML reader and Dev/RFC handoff;
- explicit product approval distinct from proposal drafting and team review;
- current Design Critique coverage for material proposal-template changes.

**Exit:** no HTML twin maintenance or hash repair by model; RFC consumes the proposal contract directly; weak-but-valid proposal fixtures score materially below strong fixtures.

### Wave 6 — Ship and release transaction v2

Resolve the delivery boundary exposed during Wave 3B:

- add an explicit `prepare-release` action before the final frozen review target;
- separate version mutation, PR delivery, merge, and main-tag placement;
- journal each external effect with target, authority grant, attempt, receipt, and verification;
- make resume idempotent after ambiguous push, PR, merge, or tracker outcomes;
- consume canonical Dev/Review/QA evidence rather than reparsing prose;
- keep root ownership for every external mutation.

**Exit:** a version bump cannot stale a passing final review; resume cannot replay a completed external effect; push/PR/merge denial is preserved as an authority boundary, not called an environment failure.

### Wave 7 — Evidence system v2

Modernize `note`, `ingest`, `research`, and `refresh` as one provenance-compatible family:

- shared evidence IDs, source type, capture time, customer/privacy classification, and content hashes;
- explicit transformations from raw import to normalized evidence to synthesized insight;
- citation and staleness validators;
- conflict-safe refresh/writeback that retains prior evidence and decisions;
- Markdown remains the primary research reader, with HTML reserved for substantial comparative reports.

**Exit:** every research claim can trace to evidence; refresh never silently deletes prior evidence; private/raw inputs remain outside committed artifacts; representative ingestion and research quality fixtures pass.

### Wave 8 — Product reasoning and inventory v2

Improve `think`, `ideate`, `strategy`, and `features` without over-engineering them:

- common decision-brief fields for problem, evidence, alternatives, decision, confidence, non-goals, and next trigger;
- evidence-backed idea ranking and strategy consistency checks;
- deterministic feature inventory extraction with stable identities and source refs;
- clear promotion contracts from Think/Ideate to Groom and from Strategy/Features into research and planning.

**Exit:** conversational workflows remain conversational, but their durable outputs are traceable and consumable without prose reconstruction.

### Wave 9 — Operational read models and effects

Align `start`, `list`, `board`, `setup`, `sync`, and `loop`:

- one canonical read model for sessions, backlog, RFCs, loop runs, leases, budgets, and recent delivery;
- identical classification across terminal List, Start pulse, and Board;
- shared effect plan/receipt semantics for configuration, sync, scheduler, and loop mutations;
- safe stale-state reconciliation and explicit recovery actions;
- local HTML board quality covered by artifact and Design Critique gates when its UI changes.

**Exit:** status surfaces cannot disagree for the same snapshot; read-only commands remain effect-free; every mutation is authority-checked and resumable.

### Wave 10 — Capture aliases, compatibility, and product polish

Finish the remaining thin surfaces:

- unify Task and Bug on one atomic capture primitive while keeping distinct defaults and Dev routing;
- keep Simplify as a tested redirect with no stale gate language;
- reconcile commands, README, Codex install docs, examples, telemetry names, and plugin manifests;
- publish a concise workflow map and artifact gallery;
- remove or archive superseded planning notes only after their completion evidence is on main.

**Exit:** all plugin surfaces pass the authoring audit; docs match runtime; no deprecated command promises behavior it no longer owns.

## Evaluation policy

### Core workflows

`groom`, `rfc`, `dev`, `design-critique`, `review`, and `ship` keep the full committed matrix:

- happy path;
- ambiguous input;
- resume;
- blocked and recovery;
- authority boundary where applicable;
- low-quality but schema-valid output;
- repeated-run variance.

Use deterministic behavioral eligibility first, then blind quality scoring. Live Sol/Opus runs remain release canaries, not default CI.

### Supporting workflows

Supporting skills receive:

- trigger and negative-trigger fixtures;
- one representative success fixture;
- one malformed/stale/authority failure fixture where applicable;
- artifact golden tests for durable outputs;
- a quality case only when model judgment materially affects a user decision.

Do not duplicate the core matrix for aliases, redirects, or read-only projections.

## Release protocol for every wave

1. Start from `origin/main` in an isolated worktree.
2. Write or update the dated wave plan and explicit acceptance criteria.
3. Add failing contract/regression tests before implementation.
4. Implement in source; keep user overrides and legacy migration paths.
5. Run focused tests, plugin validation, formatting, lint, and full suite.
6. Prepare the patch version before freezing final Review evidence.
7. Run only the routed Design Critique, QA, and Review gates. Review has one run lineage and at most three rounds.
8. Sync source to Codex and Claude caches and run representative installed-copy tests.
9. Push a feature branch, open a PR, monitor hosted CI, and merge only with explicit authority.
10. Place the version tag on the main merge commit, clean the worktree, and update the release map.

## Current concerns and decisions needed

1. Wave 3B still requires explicit `push_feature_branch` and `create_pr` authority. No source work is blocked, but the release cannot be completed without those grants. `merge` remains a separate later decision.
2. Wave 3B needed one bounded release-evidence refresh after its patch bump. That terminal pass is complete and must not be extended into another certification lineage; future waves prepare the version before final review.
3. The current authoring rules are stronger than the plugin validator. Wave 4A should land before broad skill rewrites so regressions become executable rather than review conventions.
4. Supporting skills should not inherit core-workflow ceremony. Their quality bar is contract clarity and artifact usefulness, not reviewer count.

## Next action

Land Wave 3B. Then implement Wave 4A as the first new branch: authoring validator, fixtures, machine-readable audit, and clustered remediation plan.
