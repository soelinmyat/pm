# Review Candidate Contract

## Goal

Open the PR review surface before final certification only when repository policy and adapter evidence prove that a targeted draft push is allowed, then converge every required review source on one exact head.

## Route selection

Perform a preliminary route selection before release preparation, candidate publication, or any other external effect. Read the canonical Dev session and the current schema-v1 repository delivery plan, verify their digests and identities, and call `selectPublicationRoute` from `scripts/review-convergence.js` with these three independent facts:

1. `candidateRoute` — the Dev classifier selected `review-candidate`;
2. `protectedPermission` — authenticated policy from the protected base or another approved authority explicitly permits candidate publication for the exact skipped-command set; and
3. `exactAdapterCoverage` — the current adapter proves the targeted commands, every skipped command, hook/config/tool/environment identity, destination, refs, and ref-update stdin.

All three must be true. A candidate-branch declaration, prose instruction, generic `LEFTHOOK=0`/`--no-verify` escape hatch, or adapter coverage without permission is insufficient.

Release preparation can change HEAD, so the preliminary selection cannot authorize publication. Prepare the versioned or delivery-only transaction, discard the old head-bound plan inputs, regenerate authenticated discovery/preflight/ref/plan evidence for the prepared commit, bind its three identities atomically with `dev-session.js candidate-refresh`, and call `selectPublicationRoute` again. Only that post-preparation result is authoritative.

If any fact is false or stale, select existing comprehensive Ship **before candidate publication**. Do not open an early draft, initialize convergence, or later add a second certification. Continue through the pre-existing comprehensive Review → Push → PR → CI flow unchanged and report the missing capability.

## Candidate publication boundary

The optimized route performs only these actions before review convergence:

1. Establish the release transaction, regenerate every head-bound input, and reselect the optimized route on the exact prepared commit.
2. Run current local diff Review on that exact prepared head.
3. Execute the regenerated plan's targeted repository-native commands with faithful Git hook inputs.
4. Transition the canonical candidate to `review-candidate` and require its internal authority ceiling to be `push_feature_branch: true`, `create_draft_pr: true`, and every certification/readiness/merge field false. This state never grants user authority; canonical `authority.push_feature_branch` and `authority.create_pr` must also permit the actions.
5. Record `candidate-effect` immediately before candidate attestation and the first external effect. This permanently closes rollback to the v2 session snapshot.
6. Publish the exact head and reconcile the transaction's Push effect, then create or reconcile a **draft** PR and its Create PR effect for the contracted repository/head/base.
7. After both effects are verified, transition to `reviewing`.

Never mark the PR ready, arm auto-merge, claim final certification, or enter the merge loop at this boundary. If an existing matching PR is not a draft, stop rather than silently weakening the boundary.

## Convergence record

Persist the private convergence record under `.pm/dev-sessions/{slug}/ship/review-convergence.json`. Use the pure helpers exported by `scripts/review-convergence.js`; write the returned object atomically and validate exact head and requirement-set identity before every update.

The record binds:

- one full 40- or 64-character Git object ID for the feature head;
- one SHA-256 requirement-set hash;
- the sorted, deduplicated required-source set;
- one outcome per required source (`pending`, `passed`, `blocking`, or `unavailable`);
- a bounded completion deadline;
- the required PR-conversation check and unresolved count;
- audited head mutations and requirement revisions.

Convergence is true only when every required source is `passed` on the bound head and the current required-conversation check reports zero unresolved conversations. Silence, a timeout, a missing source, an advisory summary, or a green CI check is never review convergence.

## Findings, mutation, and resume

- A blocking local, PM, Codex, bot, human, or PR-conversation finding keeps or returns the candidate to `reviewing`.
- A fix, amend, rebase, merge, generated-file update, or any other head mutation calls `markHeadMutation`. It resets all source outcomes and the conversation check. Advance the release transaction, regenerate every head-bound identity, bind them with `dev-session.js candidate-refresh`, rerun targeted checks and affected review, transition `reviewing` back to `review-candidate`, and reconcile the new generation's Push/Create PR effects before returning to `reviewing`. Preserve the first `external_effect_started_at`; do not replay `candidate-effect`.
- `unavailable` or an incomplete source at the bounded deadline enters `awaiting-decision`. It does not pass and does not silently make the source optional.
- A temporarily unavailable source may resume on the same head. Record its eventual result and converge only after all sources and conversations pass.
- Required sources may change only from `awaiting-decision` through `reviseRequirements`, with a non-empty approver, reason, new requirement-set hash, new bounded deadline, and replacement source set. The revision resets source and conversation results and returns to `reviewing`.

## Finalization handoff

After `evaluateConvergence` returns `review-converged`, transition the canonical candidate to `review-converged`. Final certification begins from that exact head and its verified Push receipt under the delivery contract owned by the finalization step. After certification, perform the live base check, transition through `base-check` to `merge-ready`, and verify the journaled `ready-pr` mutation before CI. Any later finding or mutation invalidates the handoff and returns to the remediation cycle before another certification.

## Done when

The route was reselected on the prepared commit before external effects; comprehensive fallback stayed on the legacy path, or the optimized path has verified Push/Create PR receipts, one exact draft PR, and a current convergence record whose every required source passed on one head with zero unresolved required conversations. Finalization additionally requires a verified signed certification, safe base check, `merge-ready` state, and verified `ready-pr` receipt.
