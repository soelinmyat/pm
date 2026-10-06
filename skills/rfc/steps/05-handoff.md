---
name: RFC Handoff
order: 5
description: Publish approved lifecycle state and separately authorized downstream effects
phase: handoff
requires:
required_evidence:
  - handoff
  - lifecycle
  - approval-audit
allowed_modes:
  - inline
  - headless
result_schema: rfc-phase-result-v1
---

## Goal

Publish the approved RFC and perform only the downstream effects authorized independently from design approval.

## How

1. Confirm canonical state records initial explicit approval or reviewed in-scope maintenance, and the artifact matches its current fingerprint. Read `../references/maintenance.md` for the distinction.
2. Update RFC lifecycle to `approved` and proposal lifecycle to `planned`. Keep `#rfc-lifecycle.status`, `#pm-artifact.lifecycle`, and the visible `[data-pm-lifecycle]` text equal to `approved`; preserve sidecar bytes. Run the lifecycle-only verifier against the reviewed commit, then run `node ${CLAUDE_PLUGIN_ROOT}/scripts/artifact-check.js --html {pm_dir}/backlog/rfcs/{slug}.html --kind rfc --manifest .pm/artifacts/rfc-{slug}.manifest.json`. Commit only after both gates pass. Substantive content changes must use `rfc-session revise` and return to review.
3. Build the current artifact identity for that commit, then atomically write the sibling approval/maintenance audit:

   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/rfc-session.js approval-audit \
     --session {session_path} --artifact {artifact_identity_json} --json
   ```

   Commit `{slug}.approval.json`, update the result artifact identity to the new HEAD (HTML/sidecar hashes stay unchanged), and record `approval-audit` evidence pointing to its absolute path. Dev readiness rejects an RFC without this exact audit.
   For an amendment run, the maintenance or owns edit reset the RFC lifecycle to `draft` for review, so step 2 flips only the RFC lifecycle back to `approved`, preserving the amended sidecar bytes. An amendment leaves the proposal lifecycle unchanged, because Dev already holds that proposal in progress. `approval-audit` writes a v3 maintained audit for reviewed maintenance, or a v2 audit for historical explicit re-approval, whose `amends` block names the prior run, approval hash, and prior HTML and sidecar hashes. Commit it the same way. Amendment runs grant no external authority; skip steps 4 through 7, and replace step 9 as step 9 describes. The prior run's archive stays byte-identical.
4. Treat external actions as separate authority:
   - Linear creation requires `authority.linear_create`.
   - Unattended loop pickup requires `authority.loop_approval` plus the loop's exact confirmation language.
   - Opening the browser requires `authority.open_browser`.
   - Starting implementation requires `authority.start_implementation`.
5. Grant only after explicit user direction or verified configured standing consent:

   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/rfc-session.js authorize \
     --session {session_path} --action {action} --reason {reason} --json
   ```

6. Only when Linear authority exists, read `${CLAUDE_PLUGIN_ROOT}/references/linear-operations.md`, then use sidecar issue order, sanitize local links, and verify each created identifier. Partial failure is a blocker or precise partial result, never success.
7. When loop authority exists, create/verify child cards in dependency order and use the loop's separate implementation approval contract. RFC approval never authorizes unattended merge.
8. Do not delete canonical state. Record a passing handoff result with current artifact identity plus `handoff`, `lifecycle`, and `approval-audit` evidence. The runner archives it immutably.
9. Offer `pm:dev {slug}`. Start it only with `start_implementation` authority. For an amendment run, step 8 has now archived it: if Dev runs from a different source repository than this RFC run, copy the new `.pm/rfc-sessions/completed/{slug}/{run_id}/` archive into that repository beside the prior one, because Dev verifies every lineage hop from its own `source.repo_root`. Then adopt it in the waiting Dev session with `dev-session rebind-rfc` instead of offering `pm:dev`.

## Done-when

- RFC lifecycle metadata reflects initial explicit approval or reviewed maintenance of that approved intent; maintenance leaves the proposal lifecycle unchanged.
- The committed sibling approval audit matches the exact final HTML and sidecar bytes.
- Each external effect was authorized and verified or cleanly skipped.
- Handoff evidence and current artifact identity are recorded and the session is complete.
- The user has the RFC path and correct next action.

**Advance:** RFC workflow complete. Offer `pm:dev {slug}`; do not start it without authority. For an amendment run, adopt it in the waiting Dev session with `dev-session rebind-rfc` instead of offering `pm:dev`.
