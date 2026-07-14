---
title: "Operational read models and effects v2 — Wave 9"
created: 2026-07-14
updated: 2026-07-14
status: active
owners:
  - pm-plugin
---

# Operational read models and effects v2 — Wave 9

## Outcome

Make Start, List, Board, Setup, Sync, and Loop agree about current operational state and make every mutation explainable, authority-bound, idempotent, and recoverable. Read surfaces receive one immutable snapshot; mutation commands retain their domain policy but share one plan, attempt, receipt, and recovery contract.

## Audit findings

1. `scripts/start-status.js` scans and groups backlog frontmatter independently from `scripts/lib/list-rows.js` and `scripts/loop-board.js`. The same status can therefore be called planned, in progress, an RFC, or blocked depending on the surface.
2. List shares its emitter with Start's `--format list-rows` mode, but Start's pulse does not consume those rows and Board consumes a separate Loop card graph.
3. Board alone joins cards with leases, run ledgers, daily budgets, and scheduler state. Start and List cannot report or recover those conditions from the same observation.
4. Board's read path performs a background `git fetch`. Fetch changes remote refs even though it does not edit the working tree, so it must be represented as an explicit freshness effect rather than hidden inside a read-only projection.
5. Loop reconciliation already plans before applying and uses isolated Git transactions, but its plan shape is local to Loop. Ship's verified effect receipt is not available to Setup, Sync, scheduler, or configuration mutations.
6. Setup instructs the model to edit `.pm/config.json` directly. It has no exact preimage, idempotency key, atomic effect receipt, or ambiguous-write recovery path.
7. Sync and scheduler commands report outcomes but do not persist a shared attempt identity that can distinguish a verified prior success from an interrupted or safe-to-retry attempt.

## Product laws

1. One filesystem observation produces one versioned operational snapshot. Projections may hide fields, but they may not reclassify records.
2. Artifact kind and operational lifecycle are separate axes. A proposal may be `needs_rfc`; an RFC-backed item may be `ready_for_dev`; both retain their artifact kind.
3. Read-only means no writes, commits, network fetches, scheduler changes, or state repair. Freshness checks that touch refs are explicit effects.
4. An effect is planned against an exact target and precondition before it starts. Authority names the action, not a broad permission level.
5. A verified receipt prevents replay. An interrupted attempt is observed before retry. Ambiguity produces a concrete recovery action and never optimistic success.
6. Shared primitives own identity, hashing, atomic journal writes, attempts, and receipt binding. Setup, Sync, and Loop retain their own safety and domain rules.

## Canonical operational snapshot v1

Add `scripts/lib/operational-read-model.js` with a dependency-injectable `buildOperationalSnapshot(projectDir, options)` boundary. The snapshot contains:

- `meta`: schema version, generated time, resolved source/PM/state directories, and observation identity;
- `sessions`: active Groom, RFC, Dev, and Think sessions with stable IDs, phases, age, and resume actions;
- `work_items`: one normalized record per backlog item or durable snapshot, preserving artifact kind and the canonical lifecycle column;
- `columns`: ordered lifecycle membership using `inbox`, `needs_research`, `needs_rfc`, `ready_for_dev`, `implementing`, `reviewing`, `shipping`, `needs_human`, `blocked`, and `done`;
- `leases`: active, expired, and invalid durable leases;
- `loop`: installed/paused state, recent runs, configured and consumed daily budgets, and any degraded-read error;
- `recent_delivery`: the most recently completed backlog items and terminal loop runs;
- `recovery_actions`: stable code, affected identity, reason, safe command, and whether mutation authority is required;
- `counts`: lifecycle counts derived only from canonical columns, plus compatibility aliases used by Start.

The observation identity is a SHA-256 hash of normalized source records, not timestamps or absolute machine paths. All consumers can accept a supplied snapshot in tests so parity is tested against literally identical bytes.

### Projection rules

- `scripts/lib/list-rows.js` projects sessions and work items from the snapshot. Existing sections remain for compatibility; every row adds canonical `lifecycle` and `artifactKind` fields.
- `scripts/start-status.js` keeps knowledge-base health analysis but derives active work, backlog counts, oldest-work suggestions, Loop warnings, and recovery actions from the supplied snapshot.
- `scripts/loop-board.js` becomes the compatibility CLI/projector for the snapshot instead of a second aggregate owner.
- `scripts/board-server.js` renders the same snapshot and never rescans ledgers, budgets, leases, or backlog frontmatter.
- `scripts/loop-situation.js` routes from the snapshot so the Loop command and Board cannot disagree.
- Hidden background fetch is removed from the Board request path. The payload reports observed Git freshness and offers an explicit Sync action when remote refresh is needed.

## Operational effect journal v1

Add `scripts/lib/operational-effect-journal.js`. It is a reusable record boundary, not an effect executor. Domain commands provide the mutation and observation callbacks.

Each journal stores:

- deterministic `effect_id` and `idempotency_key` from effect name, exact target, and intended value;
- owning workflow, action-specific authority, target, precondition, and redacted plan summary;
- monotonic attempts with `started_at`, terminal state, bounded error, and recovery code;
- a verified receipt bound through the existing shared effect-receipt primitive;
- current state: `planned`, `attempting`, `verified`, `blocked`, or `ambiguous`;
- a safe recovery action for every non-verified terminal state.

Journals live under `{pm_state_dir}/effects/`, are atomically written with mode `0600`, exclude credentials and raw command output, and are never copied into committed PM artifacts.

### Mutation adapters

1. **Setup/config:** add a config-effect CLI that plans a JSON-pointer update against the current file hash, preserves unrelated fields, writes atomically, re-reads the target, and returns/reuses a verified receipt. Setup uses it instead of prose-directed edits.
2. **Sync:** wrap setup, clone, pull, push, and bidirectional sync CLI actions. Observe Git remote/upstream/tip and sync-status after interruption before deciding replay. Read-only `status` creates no journal.
3. **Loop config/scheduler:** wrap config initialization/host approval and install, pause, resume, or uninstall operations. Observe exact config hash, scheduler asset/install identity, kill-switch state, and remote propagation as applicable.
4. **Loop reconciliation:** retain the isolated Git transaction, but persist its proposed changes, authority, attempt, applied paths, commit/push observation, and recovery action in the shared journal shape.
5. **Board toggle:** call the Loop pause/resume effect adapter and return its receipt/recovery state; do not maintain an unjournaled mutation shortcut.

## Recovery semantics

- Expired leases never silently return work to a dispatchable column. The snapshot emits `inspect-expired-lease` with the durable run/lease identity.
- Invalid leases emit `repair-invalid-lease`; duplicate IDs and ambiguous in-progress records retain hard-blocked classifications.
- A verified open or merged PR produces a specific reconciliation action from existing Loop logic.
- An `attempting` journal found after restart is observed first. Matching target state is promoted to `verified`; contradictory state becomes `ambiguous`; absent state may be retried only when the adapter declares replay safe.
- Recovery actions are data, not prose assembled independently by each surface. Start, List, Board, and Loop route show the same code and command.

## Acceptance and regression matrix

| Contract | Failing fixture first | Pass condition |
|---|---|---|
| Snapshot determinism | same records, different directory order/time injection | normalized records and observation ID match |
| Surface parity | mixed proposal/RFC/status/lease fixture | Start counts, List row lifecycle, Loop situation, and Board columns match one supplied snapshot |
| Kind vs lifecycle | proposal with RFC, approved task, shipping item | artifact kind is preserved while lifecycle follows canonical rules |
| Lease/run/budget parity | active, expired, invalid leases plus mixed ledgers | all projections expose identical partitions and counters |
| Read-only purity | instrument filesystem, Git runner, and scheduler adapters | Start, List, Board GET/payload, Loop status perform zero effects |
| Config effect | interrupted write and repeated identical request | unrelated fields survive; observation verifies or returns precise recovery; verified request is not replayed |
| Sync effect | interrupted push whose remote already advanced | resume observes success and reuses receipt; status creates no journal |
| Scheduler effect | interrupted install/pause/resume | installed asset or kill-switch identity is observed before retry |
| Reconcile effect | stale card with recovery-ready, ambiguous, and expired evidence | dry run remains effect-free; apply is authority-bound and receipt-backed |
| Board mutation | repeated toggle request/idempotency key | exactly one intended transition; API returns receipt or recovery action |
| Artifact quality | populated, empty, degraded, long-title, narrow, and print states | artifact check, accessibility, responsive capture, and Design Critique pass |
| Legacy compatibility | current Start/List/Loop/Board fixtures | existing fields and commands remain supported unless the plan explicitly replaces unsafe behavior |

## Delivery sequence

1. Add failing snapshot/parity/read-purity tests and the canonical snapshot builder.
2. Migrate List, Start, Loop situation, Loop board, and Board payload; remove duplicate scans and hidden fetch effects.
3. Add failing effect-journal/config tests, then implement the shared journal and Setup adapter.
4. Migrate Sync and Loop mutation entry points with interruption/resume fixtures.
5. Update skill steps, commands, README/install guidance, and recovery copy to match runtime behavior.
6. Run focused and full tests, plugin validation, artifact checks, narrow/print Board QA, and the routed Design Critique.
7. Prepare the patch release before the bounded final Review lineage; sync and smoke-test both workhorse caches.
8. Push, open and monitor the PR, merge, move the release tag to the main merge commit, update the master release map, and archive the Dev session.

## Non-goals

- A generic workflow engine or one universal transaction executor.
- Network polling inside read-only status commands.
- Converting terminal status into HTML or creating a persistent hosted service.
- Automatically repairing ambiguous leases, cards, Git divergence, or scheduler state.
- Removing existing Loop Git isolation or domain-specific safety gates.

## Exit criteria

- The same snapshot fixture cannot produce different lifecycle classifications or counts across Start, List, Board, and Loop route.
- Read-only surfaces are proven effect-free under instrumented tests.
- Setup, Sync, scheduler/config, Board toggle, and reconciliation mutations produce authority-bound plans and verified receipts or explicit recovery actions.
- Interrupted effects resume by observation and do not replay a verified mutation.
- Board's material UI changes pass artifact validation, responsive/print QA, and Design Critique.
- Full tests, plugin validation, bounded Review, cache smoke, hosted CI, merge, and exact main-tag verification pass.
