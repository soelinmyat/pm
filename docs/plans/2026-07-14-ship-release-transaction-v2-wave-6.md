# Wave 6 — Ship and Release Transaction v2

**Date:** 2026-07-14  
**Status:** implementation  
**Base:** `origin/main` at `12177f26063176b64b36b2aef2e99bf787a4e3fa` (`v1.13.26`)  
**Branch:** `codex/ship-v2`

## Outcome

Ship becomes a resumable release transaction instead of a sequence reconstructed from prose and ambient CLI state. Version mutation happens before the final frozen review. Push, PR creation, merge, main-tag placement, and tracker updates each have a target-bound journal entry, explicit authority, attempt history, receipt, and independent observation.

## Problems to eliminate

1. The version bump currently runs after certification, so it changes the reviewed tree and forces either stale evidence or another review.
2. The bump script creates a tag on a feature commit even though the installable release tag must point to the final `main` commit.
3. Ship resume infers progress from prose and may replay an effect after a timeout or interrupted command.
4. Push, PR, merge, and tracker failures are not consistently distinguished from missing authority.
5. The delivery path duplicates identity and retry logic across Markdown steps without one executable state machine.

## Transaction model

The canonical private record is:

```text
.pm/dev-sessions/{slug}/ship/release-transaction.json
```

It binds:

- the Dev run, feature branch, delivery remote, default branch, repository identity, and prepared feature commit;
- the release version and tag expected after merge;
- the final Review, QA, and verification evidence identities;
- ordered effect records for `push`, `create-pr`, `merge`, `place-main-tag`, and `tracker-update`;
- every effect target, required authority action, idempotency key, attempt, receipt, observation, and terminal classification.

Effect states:

| State | Meaning | Resume behavior |
|---|---|---|
| `planned` | Exact target and authority requirement are frozen; no call started | May begin only with current authority |
| `attempting` | An external call started and its outcome may be unknown | Observe first; never replay immediately |
| `verified` | Independent observation matches the planned target and receipt | Return a no-op success after revalidation |
| `denied` | Canonical authority was absent | Preserve as an authority boundary; a later grant creates a new attempt |
| `blocked` | Observation conflicts with the target or safe replay cannot be established | Stop with exact conflicting identity |
| `failed` | A definite non-ambiguous failure occurred | Retry only within the bounded policy |

`attempting` is intentionally durable before the network call. A crash, timeout, or lost terminal therefore resumes through observation rather than duplicate mutation.

## Release preparation

Add an explicit `prepare-release` action that runs after implementation commits and before final Review:

1. require a clean feature branch and canonical Dev session;
2. calculate the requested patch/minor/major/explicit version;
3. update `plugin.config.json` and generated platform manifests;
4. commit the version mutation without creating a tag;
5. write the prepared version, tag, commit, and manifest hashes to the transaction;
6. route final Design Critique/QA/Review/verification against that prepared commit.

The existing `bump-version.js` remains a bounded compatibility path for one release while public docs and hooks move to `prepare-release`. It must clearly identify the legacy feature-tag behavior and must not be the documented Ship path after Wave 6.

## Delivery boundaries

### Push

- Target: delivery remote, repository, branch, prepared feature commit.
- Authority: `push_feature_branch`.
- Observation: remote branch tip equals prepared feature commit.
- Resume: matching tip verifies; absent tip permits a new attempt; a different tip blocks.

### Create PR

- Target: repository, exact head, exact base, prepared feature commit.
- Authority: `create_pr`.
- Observation: exactly one PR with matching repository/head/base and matching head OID.
- Resume: matching PR verifies; zero matches permits creation; multiple/conflicting matches block.

### Merge

- Target: the verified PR, head commit, base branch, merge method.
- Authority: `merge`.
- Observation: PR state `MERGED`, observed head OID equals the prepared commit, merge SHA is present.
- Resume: a merged matching PR verifies without replay; an open PR resumes monitoring; a closed-unmerged PR blocks.

### Place main tag

- Target: release tag and the verified merge SHA on the authoritative default branch.
- Authority: `merge` as the release-completion grant; the effect remains separately journaled.
- Preconditions: merge effect verified, merge SHA equals the current authoritative default-branch tip or is an ancestor permitted by repository policy.
- Observation: remote tag peels to the merge SHA.
- Resume: matching tag verifies; absent tag permits placement; a tag pointing elsewhere blocks and never force-moves automatically.

### Tracker update

- Target: exact tracker issue and terminal state/comment identity.
- Authority: `tracker_updates`.
- Observation: issue state/comment match.
- Resume: matching tracker state verifies; unavailable tracker is an external-system failure, not an authority denial.

## Executable surfaces

### Runtime

- `scripts/lib/release-transaction-schema.js` — schema, invariants, state transitions, resume decisions.
- `scripts/release-transaction.js` — CLI for initialize/prepare, plan, begin, observe, fail/deny, status, and verification.
- shared `workflow-runtime/effect-receipt.js` remains the receipt binding primitive.

### Skill contract

- Rewrite Ship around `prepare-release` and the transaction rather than `.md` status reconstruction.
- Preserve current delivery-contract identity checks, but make the transaction the execution journal.
- Consume canonical Dev/Review/QA gate evidence directly.
- Keep every external mutation root-owned.
- Make `denied` and `failed` visibly different terminal classes.

### Hooks and versioning

- Stop requiring a feature-commit tag merely to push a prepared release.
- Require a current prepared-release transaction when the manifest version is newer than the authoritative base.
- Verify the release tag only after merge and bind it to the `main` merge SHA.
- Update AGENTS.md, README, and install/release guidance together.

## Work units

### W6.1 — Transaction schema and journal

Implement closed schemas, deterministic serialization, atomic writes, effect transitions, authority denial, ambiguous-outcome reconciliation, and current-state validation.

### W6.2 — Prepare-release and version flow

Implement version calculation, manifest mutation, commit-without-tag behavior, prepared-commit binding, compatibility diagnostics, and hook support.

### W6.3 — Ship workflow migration

Migrate Ship steps and references to initialize, update, reconcile, and verify the transaction at every boundary. Remove prose-only replay decisions.

### W6.4 — Delivery observers and receipts

Define normalized observation inputs for branch, PR, merge, tag, and tracker effects. Require exact identity matches before terminal verification.

### W6.5 — Regression and behavioral evaluation

Cover:

- prepare-release precedes final Review;
- no feature tag is created;
- a passing Review remains current through push and PR creation;
- missing authority records `denied`, not environment failure;
- ambiguous push/PR/merge/tag outcomes observe before retry;
- verified effects are never replayed;
- conflicting remote branch, PR, or tag identity fails closed;
- tag placement is impossible before verified merge;
- canonical Dev/Review/QA evidence is required;
- legacy Ship state remains inspection-readable during the compatibility window.

### W6.6 — Certification and release

Run plugin validation, the full suite, Ship behavioral fixtures, installed-cache canaries, evidence-bound Review, patch release preparation under the current repository rules, PR, merge, and correct `main` tag placement.

## Exit criteria

- Version mutation is committed before the final Review target is frozen.
- No new release path creates an installable tag on a feature commit.
- Every external effect has target, authority, attempt, receipt, and observation evidence.
- Resume observes an ambiguous outcome before deciding whether another attempt is safe.
- A verified effect is idempotent and cannot be replayed.
- Authority denial is preserved as `denied`, not mislabeled as an environment failure.
- Push/PR/merge/tag identity conflicts fail closed.
- Ship consumes canonical Dev, Review, QA, and verification evidence.
- Runtime tests, behavioral fixtures, plugin validation, full tests, and both installed-cache canaries pass.

## Non-goals

- Replacing GitHub CLI or implementing a general workflow engine.
- Automatically force-moving a conflicting release tag.
- Granting external-effect authority from preferences or prior successful releases.
- Moving external mutations into implementation/review workers.
- Redesigning tracker-specific APIs beyond the shared journal contract.
