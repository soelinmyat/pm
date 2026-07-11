# RFC Session State Schema

Canonical state lives at `{source_dir}/.pm/rfc-sessions/{slug}/session.json` and conforms to `rfc-session.schema.json`.

## Ownership and durability

- State is machine-local under the source repository's gitignored `.pm/`; RFC HTML/JSON artifacts live under the resolved PM content directory.
- `session.json` is the only lifecycle authority. Human-readable projections are optional and never drive transitions.
- Writes are atomic, mode `0600`, lock-protected, and idempotent for retried phase results.
- Completed sessions move atomically to `{source_dir}/.pm/rfc-sessions/completed/{slug}/session.json` as approval audits. The active scanner does not traverse that archive.

## Phases

| Phase | Meaning | Exit |
|---|---|---|
| `intake` | Product source, M/L/XL size, and ACs validated | Context and passing intake result |
| `generation` | RFC HTML/sidecar created and validated | Commit-linked artifact identity |
| `review` | Required technical lenses run | All lenses pass on current hash |
| `approval` | Reviewed artifact awaits human decision | Explicit `approve` command only |
| `handoff` | Approved lifecycle and separately authorized effects | Verified handoff result |

Session status is `active`, `awaiting_approval`, `approved`, `blocked`, or `complete`. Review completion sets `awaiting_approval`; only `approve` sets approval status and advances to handoff.

Use `revise --reason <reason>` to invalidate review/approval and return an awaiting or approved session to review. Use `unblock --resolution <resolution>` to resolve the current blocker and resume the same phase. Both transitions are audited in session history.

## Artifact identity

The state binds generation, review, approval, and handoff to:

- absolute HTML and JSON sidecar paths;
- SHA-256 of the HTML bytes;
- SHA-256 of the sidecar bytes;
- artifact repository root and commit.

Approval verifies both current HTML and sidecar bytes equal the reviewed fingerprint. A content edit routes back through review. The expected approval metadata-only HTML/commit update may change the HTML hash and commit but not the sidecar hash, and requires passing lifecycle-only evidence.

## External authority

`linear_create`, `loop_approval`, `open_browser`, and `start_implementation` default false. Each grant has an audit record with action, reason, and timestamp. RFC approval does not expand these booleans.

## Legacy migration

Retain legacy `.md` sessions. Parse identity and artifact paths, then write canonical JSON. Because the old workflow could set `approved` before asking the human, legacy `rfc-review` and `approved` stages return to technical review/approval recertification and never import approval provenance as trusted.
