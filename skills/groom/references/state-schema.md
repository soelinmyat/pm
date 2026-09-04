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
    "evidence_refs": [],
    "artifact_repo_root": "/absolute/artifact-worktree"
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
    "proposal_snapshot_sha256": null,
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

The executable closed schema is `scripts/lib/groom-session-schema.js`. Newly created sessions use schema v2, whose Quick route includes bounded Design and Review. Existing schema-v1 sessions remain resumable on the route they froze; never rewrite their completed history to imitate v2.
Fresh context requires `artifact_repo_root` to identify the matching helper-owned
`codex/{slug}-groom` worktree. On read, v1 sessions written before this field existed
are normalized to `null` so in-flight work can resume against the historical source
repository fallback without being mistaken for newly verified isolation. Fresh sessions
revalidate the helper-owned branch and delivery URL on every resume operation; the next
legacy mutation persists the explicit compatibility marker.

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
  "question_outcomes": [
    {
      "question_id": "scope",
      "proposal_hash": "sha256:...",
      "verdict": "pass | advisory",
      "conclusion": "Decision reached",
      "rationale": "Why it follows",
      "evidence": [
        {
          "evidence_id": "evidence:registered-id",
          "locator": "Precise location",
          "relevance": "How this location bears on this answer"
        }
      ],
      "confidence": "high | medium | low",
      "finding": null
    }
  ],
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

The Draft and later applicable results carry exact proposal identity. Review results contain one current outcome for every routed independent question. Each result outcome must exactly match the canonical proposal row's conclusion, rationale, evidence, confidence, finding, and outcome/verdict before the session records Review as passed. Capability downgrades state the missing capability and chosen execution fallback; they never change product policy.

For current schema-v2 sessions, `routing.review_questions` must exactly match the selected tier's built-in contract. The canonical proposal copies the session ID, tier, and ordered IDs into `review_contract`; Review and Approval recompute that binding and reject partial, duplicate, extra, or stale question rows. Legacy sessions and proposals remain readable with an explicit compatibility label, but their unbound rows cannot impersonate current review coverage.

## Approval chain

1. Review certifies semantic `content_hash` plus `revision`.
2. The user explicitly approves; `approve` first recomputes any bound prototype from current repository bytes, then records an immutable session decision ID/hash against that reviewed identity.
3. Canonical proposal lifecycle changes to `approved` without substantive content/revision change.
4. `approval-audit` independently recomputes any bound prototype again, then binds the session decision and exact approved JSON bytes.
5. `proposal-check.js` verifies proposal, audit, and generated projections before handoff.

Each crash window fails closed. A substantive revision clears review and approval and routes to the requested earlier phase.

## External authority

Groom local proposal writes are lifecycle work. Tracker creation, browser opening, RFC start, and external research are separate authority fields. Grant them with `authorize`; external mutations also require target-bound idempotent effect receipts.

## Migration

`migrate --legacy .pm/groom-sessions/{slug}.md` imports only bounded resumable context. Legacy approval is always recorded as untrusted and must be re-reviewed/re-approved under the canonical contract.
