# Review Candidate Contract

## Goal

Open the PR review surface before final certification only when repository policy and adapter evidence prove that a targeted draft push is allowed, then converge every required review source on one exact head.

## Route selection

Route selection happens before release preparation, candidate publication, or any other external effect. Read the canonical Dev session and the current schema-v1 repository delivery plan, verify their digests and identities, and call `selectPublicationRoute` from `scripts/review-convergence.js` with these three independent facts:

1. `candidateRoute` — the Dev classifier selected `review-candidate`;
2. `protectedPermission` — authenticated policy from the protected base or another approved authority explicitly permits candidate publication for the exact skipped-command set; and
3. `exactAdapterCoverage` — the current adapter proves the targeted commands, every skipped command, hook/config/tool/environment identity, destination, refs, and ref-update stdin.

All three must be true. A candidate-branch declaration, prose instruction, generic `LEFTHOOK=0`/`--no-verify` escape hatch, or adapter coverage without permission is insufficient.

If any fact is false or stale, select existing comprehensive Ship **before candidate publication**. Do not open an early draft, initialize convergence, or later add a second certification. Continue through the pre-existing comprehensive Review → Push → PR → CI flow unchanged and report the missing capability.

## Candidate publication boundary

The optimized route performs only these actions before review convergence:

1. Run current local diff Review on the exact feature head.
2. Re-run environment preflight and execute the plan's targeted repository-native commands with faithful Git hook inputs.
3. Transition the canonical candidate to `review-candidate` and require its internal authority ceiling to be `push_feature_branch: true`, `create_draft_pr: true`, and every certification/readiness/merge field false. This state never grants user authority; canonical `authority.push_feature_branch` and `authority.create_pr` must also permit the actions.
4. Publish the exact head using only the hash-bound repository candidate-push contract, then create or reconcile a **draft** PR for the contracted repository/head/base.
5. Record the external-effect start and transition to `reviewing`.

Never mark the PR ready, arm auto-merge, claim final certification, or enter the merge loop at this boundary. If an existing matching PR is not a draft, stop rather than silently weakening the boundary.

## Convergence record

Persist the private convergence record under `.pm/dev-sessions/{slug}/ship/review-convergence.json`. Use the pure helpers exported by `scripts/review-convergence.js`; write the returned object atomically and validate exact head and requirement-set identity before every update.

The record binds:

- one 40-character feature-head SHA;
- one SHA-256 requirement-set hash;
- the sorted, deduplicated required-source set;
- one outcome per required source (`pending`, `passed`, `blocking`, or `unavailable`);
- a bounded completion deadline;
- the required PR-conversation check and unresolved count;
- audited head mutations and requirement revisions.

Convergence is true only when every required source is `passed` on the bound head and the current required-conversation check reports zero unresolved conversations. Silence, a timeout, a missing source, an advisory summary, or a green CI check is never review convergence.

## Findings, mutation, and resume

- A blocking local, PM, Codex, bot, human, or PR-conversation finding keeps or returns the candidate to `reviewing`.
- A fix, amend, rebase, merge, generated-file update, or any other head mutation calls `markHeadMutation`. It resets all source outcomes and the conversation check; rerun targeted checks and every affected review source on the new head.
- `unavailable` or an incomplete source at the bounded deadline enters `awaiting-decision`. It does not pass and does not silently make the source optional.
- A temporarily unavailable source may resume on the same head. Record its eventual result and converge only after all sources and conversations pass.
- Required sources may change only from `awaiting-decision` through `reviseRequirements`, with a non-empty approver, reason, new requirement-set hash, new bounded deadline, and replacement source set. The revision resets source and conversation results and returns to `reviewing`.

## Finalization handoff

After `evaluateConvergence` returns `review-converged`, transition the canonical candidate to `review-converged`. Final certification begins from that exact head under the delivery contract owned by the finalization step. Any later finding or mutation invalidates the handoff and returns to `reviewing` before another certification.

## Done when

The route was chosen before external effects; comprehensive fallback stayed on the legacy path, or the optimized path has one exact draft PR and a current convergence record whose every required source passed on one head with zero unresolved required conversations.
