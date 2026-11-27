---
name: Approval
order: 9
description: Record explicit product approval against exact reviewed proposal bytes
phase: approval
applies_to: [quick, standard, full, agent]
required_evidence: [approval]
result_schema: groom-phase-result-v1
---

## Goal

Obtain and record an explicit human product decision for the exact current proposal.

## How

Verify current source/projections, the current quality result, and the tier-routed question review. For schema-v2 sessions, require the canonical `review_contract` to match the trusted session ID, tier, and ordered routed question IDs, with exactly one current `question_reviews` row per ID. The `quick` tier must have completed its bounded Review phase; Approval never fabricates a substitute integrity row or moves a draft directly to reviewed. A resumed schema-v1 `quick` session is the one compatibility exception: honor its frozen route, which moves from Draft directly to Approval, and do not invent a Review phase or mutate its historical route. Regenerate projections and run `proposal-check.js --projections`; for schema v2, do not ask for approval while the canonical proposal remains `draft`. For a frozen schema-v1 direct-approval route, use its legacy integrity and approval checks against the exact draft bytes.

Ask one direct question, and say what approval also does in the same message:

> Approve this proposal for technical design? Approving also lets PM merge the finished work to the remote default branch with no further review from you, but only when every gate, CI and the merge check pass at the merge commit. Anything that fails stays an open PR with the report. Say "approve, but I'll merge" to keep the merge for yourself.

When the project's PM instructions say `Merge: manual`, or the proposal is not at `{pm_dir}/backlog/proposals/{slug}.json`, ask only "Approve this proposal for technical design?" and say a merge will need a separate confirmation. Silence, earlier enthusiasm, reviewer verdicts, tracker state, and authority to implement do not count. On approval, use this exact order: (1) run `groom-session.js approve --approved-by {identity}` against the current route-valid bytes, adding `--merge manual` when the user kept the merge for themselves, (2) transition only canonical `lifecycle` from `reviewed` to `approved` for schema v2 or from `draft` to `approved` for the frozen schema-v1 direct-approval route, without changing revision or semantic content, (3) run `approval-audit` so it binds the exact approved bytes and session decision, (4) regenerate projections, and (5) run `proposal-check.js --approved --projections` with the session decision ID/hash. `--approved` is the strict handoff mode: it requires the current review contract, retained evidence, explicit Groom decision identity, current design classification, and complete prototype binding. Never create the audit before the approved lifecycle bytes exist. On requested changes, run `revise`, return to the earliest affected phase, and invalidate old review/approval. On no decision, preserve `awaiting_approval` and stop cleanly.

### Standing merge authorization

`approve` records a `merge_authorization` beside the decision and binds it into the decision hash, so `approval-audit` carries it to Dev. It names the approver, the time, the Groom run and the proposal revision and content. It is `granted` by default, `declined` with `--merge manual`, and `declined` when `{pm_dir}/instructions.md` or `instructions.local.md` has a line `Merge: manual`, however it is formatted (quoted, bracketed, bold, in a list or task list). A proposal outside `{pm_dir}/backlog/proposals/` is also `declined`, because its instructions cannot be found. Proposals without a bound review session get none. Relay the command's `merge_authorization_notice` to the user. A retry cannot change the choice; revise and approve again. After approval the owner can still withdraw it with `dev-session.js merge-authorization-revoke` or by adding `Merge: manual`.

The authorization never covers sessions without this approved proposal, never bypasses a gate, and never merges by itself: Ship runs `dev-session.js merge-check` at the merge commit.

### Optional bounded technical delivery

When the user has explicitly authorized autonomous technical delivery of this reviewed product direction, record that scope at the same product decision. Show the accepted behavior/preview, commercial assumptions and significant security, privacy and operational constraints. Explain that independent technical review will determine whether the initial RFC preserves these boundaries; material or uncertain changes return for a concrete decision. Do not ask again when this scope is already explicit in the current conversation.

Use `groom-session.js approve --session {session_path} --approved-by {identity} --delegate-content-sha256 {reviewed_content_sha256}`. The confirmation must be the exact current canonical content hash. The runner derives a closed `delivery_delegation` grant with only `technical_derivation` and `implementation`, bound to the Groom run/source, proposal revision/content/snapshot and original product decision. Follow the same lifecycle/audit/projection order above. Omitting the flag preserves the separate initial RFC approval path. A legacy/unbound review or unresolved product decision cannot receive this grant. A retry cannot append delegation to an earlier decision; revise and record a new explicit scoped product decision instead.

The grant covers in-scope technical work. It grants no tracker writes, push, merge, deployment, or platform permission; merging rests only on the standing merge authorization above, and the rest remain independently authorized. Never manufacture a grant in intake facts, infer one from prose or copy it to another product revision.

## Done-when

Either a verified hash/revision-bound approval audit exists for the current proposal or the session is durably paused at `awaiting_approval` without a false approval claim.

**Advance:** after approval, proceed to Step 10 (Handoff).
