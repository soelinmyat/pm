---
name: RFC Approval
order: 4
description: Record the user's explicit decision for the exact reviewed artifact
phase: approval
requires:
required_evidence:
allowed_modes:
  - inline
result_schema: explicit-approval-command
---

## Goal

Record the user's explicit decision for the exact reviewed artifact without loading or performing downstream handoff effects.

## How

1. Show the Decision Brief, biggest risk, unresolved product decisions, RFC path, and reviewed artifact fingerprint. State that technical review passed but approval has not been recorded.
2. Ask one direct question: "Approve this RFC for implementation?" Silence, prior proposal approval, reviewer verdicts, loop configuration, and tracker consent are not RFC approval.
3. If the user declines, keep `awaiting_approval`. If the user requests changes, record the audited transition before editing:

   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/rfc-session.js revise \
     --session {session_path} --reason {requested_change} --json
   ```

   This invalidates the prior review/approval binding and returns to review.
4. If the user explicitly approves, record it before any lifecycle or external write:

   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/rfc-session.js approve \
     --session {session_path} --approved-by {identity} --json
   ```

   The command re-hashes both HTML and sidecar, verifies the binding and reviewed fingerprint, records approver/timestamp/fingerprint, and advances to handoff.
5. In Loop Worker Mode, never invoke `approve`; return `needs-approval` and stop.

## Done-when

- Explicit approval is recorded for the exact reviewed artifact and the runner returns handoff; or
- The session remains `awaiting_approval`; or
- Requested changes have invalidated review and returned the session to review.

**Advance:** after explicit approval only, proceed to Step 05 (RFC Handoff).
