# Groom Session State

Canonical private state lives at `.pm/groom-sessions/{slug}/session.json` with mode 0600. Completed runs move to `.pm/groom-sessions/completed/{slug}/{run_id}/session.json`. Project proposal content never lives in session state.

Use `scripts/groom-session.js`; do not edit session JSON directly.

## Lifecycle

```text
intake → research → scope → synthesis → design → draft → review → presentation → approval → handoff → retro
```

Tier routing is defined in `tier-gating.md`. Approval is never a normal phase result: only the explicit `approve` command can leave `awaiting_approval`.

## Core state

```json
{
  "schema_version": 1,
  "run_id": "groom_...",
  "slug": "feature-slug",
  "status": "active | awaiting_approval | approved | blocked | complete",
  "phase": "intake | research | scope | synthesis | design | draft | review | presentation | approval | handoff | retro",
  "phase_attempt": 1,
  "created_at": "ISO-8601",
  "updated_at": "ISO-8601",
  "source": {
    "repo_root": "/absolute/repo",
    "worktree": "/absolute/repo",
    "branch": "feature-branch",
    "base_commit": "git-sha"
  },
  "context": {
    "configured": true,
    "tier": "quick | standard | full | agent",
    "title": "Title",
    "outcome": "Outcome",
    "source_kind": "idea | backlog | legacy",
    "source_path": null,
    "evidence_refs": []
  },
  "routing": {
    "required_phases": [],
    "review_questions": [],
    "kb_gate": "normal | strict"
  },
  "proposal": {
    "json_path": "/absolute/path.json",
    "proposal_sha256": "sha256:...",
    "content_hash": "sha256:...",
    "revision": 1,
    "lifecycle": "draft"
  },
  "review": {
    "status": "not_started | passed",
    "proposal_hash": null,
    "rounds": 0,
    "outcomes": [],
    "reviewed_at": null
  },
  "approval": {
    "status": "pending | approved",
    "approved_by": null,
    "approved_at": null,
    "proposal_hash": null,
    "proposal_revision": null,
    "decision_id": null,
    "decision_sha256": null
  },
  "authority": {
    "tracker_create": false,
    "open_browser": false,
    "start_rfc": false,
    "external_research": false
  },
  "authority_log": [],
  "execution": {},
  "attempts": [],
  "blockers": [],
  "history": [],
  "migration": null
}
```

The executable closed schema is `scripts/lib/groom-session-schema.js`.

## Phase result

Every non-approval phase returns `groom-phase-result-v1`:

```json
{
  "schema_version": 1,
  "run_id": "groom_...",
  "phase": "scope",
  "attempt": 1,
  "status": "passed | failed | blocked",
  "summary": "What this phase decided",
  "proposal": null,
  "evidence": [{ "kind": "scope", "command": "...", "exit_code": 0, "artifact": null }],
  "question_outcomes": [],
  "capability_downgrades": [],
  "blocker": null,
  "runtime": {
    "provider": "codex | anthropic | inline",
    "model": "model identity",
    "reasoning": "high | xhigh",
    "session_id": null
  }
}
```

The Draft and later applicable results carry exact proposal identity. Review results contain one current outcome for every routed independent question. Capability downgrades state the missing capability and chosen execution fallback; they never change product policy.

## Approval chain

1. Review certifies semantic `content_hash` plus `revision`.
2. The user explicitly approves; `approve` records an immutable session decision ID/hash against that reviewed identity.
3. Canonical proposal lifecycle changes to `approved` without substantive content/revision change.
4. `approval-audit` binds the session decision and exact approved JSON bytes.
5. `proposal-check.js` verifies proposal, audit, and generated projections before handoff.

Each crash window fails closed. A substantive revision clears review and approval and routes to the requested earlier phase.

## External authority

Groom local proposal writes are lifecycle work. Tracker creation, browser opening, RFC start, and external research are separate authority fields. Grant them with `authorize`; external mutations also require target-bound idempotent effect receipts.

## Migration

`migrate --legacy .pm/groom-sessions/{slug}.md` imports only bounded resumable context. Legacy approval is always recorded as untrusted and must be re-reviewed/re-approved under the canonical contract.
