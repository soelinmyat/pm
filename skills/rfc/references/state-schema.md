# RFC Session State Schema

Canonical state lives at `{source_dir}/.pm/rfc-sessions/{slug}/session.json` and conforms to `rfc-session.schema.json`.

## Ownership and durability

- State is machine-local under the source repository's gitignored `.pm/`; RFC HTML/JSON artifacts live under the resolved PM content directory.
- `session.json` is the only lifecycle authority. Human-readable projections are optional and never drive transitions.
- Provider-neutral record, prompt, profile, and authority mechanics come from `scripts/lib/workflow-runtime/`; RFC retains context, artifact, review-lens, approval, lifecycle-marker, and handoff policy.
- Writes are atomic, mode `0600`, lock-protected, and idempotent for retried phase results.
- Completed sessions move atomically to `{source_dir}/.pm/rfc-sessions/completed/{slug}/{run_id}/session.json`. The active slug directory retains only a bounded completion pointer for idempotent retry, and the active scanner does not traverse the immutable archive.
- The session archive preserves workflow provenance. Dev approval authority is the committed `{slug}.approval.json` beside the final HTML/sidecar, whose hashes must match the exact bytes.

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

## Amendments

An amendment run corrects work-unit ownership after handoff without rewriting an approved run. `rfc-session amend` reads a completed archive and opens a new run at review with `session.amendment`:

- `of_run_id`, `prior_artifact` (the full prior identity), `prior_approval_sha256` (the committed prior audit), `amended_issue_nums`, `reason`, and `created_at`.
- The amended sidecar may differ from the prior one only by appended `owns` entries on the declared issues. Removal, reordering, other fields, and undeclared issues are rejected at review, approval, and handoff.
- Approval requires `--approved-sidecar-sha256` equal to the reviewed sidecar hash. The amendment block is part of the approval digest; runs without it keep their original digest.
- Handoff writes a schema-v2 approval audit: the v1 fields plus `amends` (`run_id`, `approval_sha256`, `sidecar_sha256`, `html_sha256`), `amended_issue_nums`, and `reason`. See `rfc-approval.schema.json`.
- The amended HTML may differ from the prior approved HTML only in lifecycle, the sidecar hash, and one `<li>` per added path. Review, approval, handoff, and every Dev lineage hop check this.
- `rfc-session withdraw --session <path> --reason <why>` closes an open amendment without approval. It moves the session bytes to `completed/{slug}/withdrawn/{run_id}/session.json` beside a `withdrawal.json` record (`run_id`, `slug`, `amends_run_id`, `reason`, `withdrawn_at`) and frees the slug for another amendment. Loop workers cannot withdraw.
- Only the latest run may be amended (not one a later run superseded or an amendment already replaced), one amendment at a time. An amendment must add at least one path; a declared issue may end up adding none. Amendments grant no external authority. Chains are limited to 16 hops.
- Original runs carry `amendment: null`; legacy archives that omit the field still validate.

## Design context

For an approved canonical proposal, intake copies the proposal execution contract's closed `design_context` into `session.context.design_context`; callers cannot supply or override it. Legacy Markdown and Linear remain supported fresh sources only after the caller confirms and supplies the same closed current shape during intake. The field contains exact design requirement strings, explicit UI impact, an explicit `null` or source-bound prototype identity, critical states, and applicable experience/visual invariants. Multi-file prototypes carry a complete deterministic tree manifest, not only an `index.html` digest. Generation, review, approval, handoff, and Dev readiness reject a schema-v3 RFC without this context or whose value differs. Wherever repository context is available, validation recomputes the complete identity instead of accepting hash-shaped text.

Historical schema-v2 sidecars, early schema-v3 sidecars without the complete context, and sessions with a `null`/legacy-partial context remain inspection-readable for compatibility. They are non-executable: for an active in-flight session, write current intake facts and run `rfc-session.js recertify --session <path> --facts <facts.json> --json`. That audited transition returns the run to intake and invalidates its prior artifact, review, approval, runtime continuation, and external authority before persisting the current context. Completed sessions remain immutable, so initialize a new RFC run instead. A canonical proposal that predates the field returns to Groom first; its recertification facts then derive the approved context rather than accepting a caller override.

## External authority

`linear_create`, `loop_approval`, `open_browser`, and `start_implementation` default false. Each grant has an audit record with action, reason, and timestamp. RFC approval does not expand these booleans.

## Legacy migration

Retain legacy `.md` sessions. Parse identity and artifact paths, then write canonical JSON. Because the old workflow could set `approved` before asking the human, legacy `rfc-review` and `approved` stages return to technical review/approval recertification and never import approval provenance as trusted.
