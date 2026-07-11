---
name: Approval and Handoff
order: 4
description: Record explicit approval for the reviewed hash, then perform separately authorized handoff effects
phase: approval
requires:
  - ../../../references/linear-operations.md
result_schema: rfc-phase-result-v1
---

## Goal

Record the user's explicit decision for the exact reviewed artifact, then publish only the separately authorized handoff state.

## How

### Approval phase

1. Show the Decision Brief, biggest risk, unresolved product decisions, RFC path, and reviewed artifact hash. State that technical review passed but approval has not been recorded.
2. Ask one direct question: "Approve this RFC for implementation?" Silence, prior proposal approval, reviewer verdicts, loop configuration, and standing tracker consent are not RFC approval.
3. If the user declines or requests changes, keep `awaiting_approval`. Changes route back to review and require a new reviewed hash.
4. If the user explicitly approves, record it before any lifecycle or external write:

   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/rfc-session.js approve \
     --session {session_path} --approved-by {identity} --json
   ```

   The command re-hashes the sidecar and verifies the HTML binding. Approval records approver, timestamp, and reviewed artifact hash, then advances to handoff.

### Handoff phase

5. Update RFC lifecycle to `approved` and proposal lifecycle to `planned`, preserving the approved sidecar hash. Revalidate and commit the expected metadata-only change. If substantive content changed, stop and route back to review.
6. Treat external actions as separate authority:
   - Linear creation requires `authority.linear_create`.
   - Unattended loop pickup requires `authority.loop_approval` plus the loop's own exact confirmation language.
   - Opening the browser requires `authority.open_browser`.
   - Starting or dispatching implementation requires `authority.start_implementation`.

   Grant only after explicit user direction or verified configured standing consent:

   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/rfc-session.js authorize \
     --session {session_path} --action {action} --reason {reason} --json
   ```

7. When Linear authority exists, follow `linear-operations.md`. Use sidecar issue order; sanitize local links; verify every created identifier. A partial external failure records a blocker or precise partial result—never synthetic success.
8. When loop authority exists, create/verify child cards in sidecar dependency order and record implementation approval using the loop's separate approval contract. RFC approval alone does not authorize unattended merge.
9. Do not delete the canonical RFC session. Record the handoff result with the approved artifact identity and passing `handoff` evidence; the runner marks it complete.
10. Offer `pm:dev {slug}` as the next action. Start it only when separately authorized.

## Done-when

- Explicit human approval is recorded for the exact reviewed artifact hash.
- RFC/proposal lifecycle metadata reflects approval without changing approved design content.
- Every external effect either had explicit authority and was verified or was cleanly skipped.
- The handoff result is recorded, the durable session is complete, and the user has the RFC path and correct next action.

**Advance:** RFC workflow complete. Offer `pm:dev {slug}`; do not start it without authority.
