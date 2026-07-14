# Structured Proposal Contract

## Source and projections

The canonical product source is `{pm_dir}/backlog/proposals/{slug}.json` (schema version 1).

`scripts/proposal-render.js` deterministically generates:

- the human HTML reader at `{pm_dir}/backlog/proposals/{slug}.html`;
- the compatibility Markdown backlog projection at `{pm_dir}/backlog/{slug}.md`.

Generated HTML and generated Markdown are never edited independently. Regenerate both from canonical JSON, then run `scripts/proposal-check.js`. The approval audit is `{pm_dir}/backlog/proposals/{slug}.approval.json` and is not a content source.

## Lifecycle and revision

| Canonical lifecycle | Backlog projection | Meaning |
|---|---|---|
| `draft` | `drafted` | Content is being assembled; no review or approval claim |
| `reviewed` | `drafted` | Required questions passed for the exact revision/hash |
| `approved` | `proposed` | Explicit product approval audit verifies the exact current bytes |
| `planned` | `planned` | Technical RFC was explicitly approved; product trust is preserved by revision/content/decision identity |
| `in-progress` | `in-progress` | Implementation started |
| `done` | `done` | Delivery completed |

Lifecycle-only changes advance monotonically (`approved → planned → in-progress → done`) while keeping the revision and semantic content hash. At `approved`, the audit must match the exact current bytes. Later lifecycle bytes differ by definition, so consumers verify the original approved-byte hash plus the unchanged revision, semantic content hash, and session decision identity. A substantive edit increments `revision`, clears current review/approval, and returns to the earliest affected Groom phase. Never infer approval from a Markdown status.

## Required JSON shape

The executable schema lives in `scripts/lib/proposal-schema.js`; this reference explains how to fill it well.

```json
{
  "schema_version": 1,
  "id": "proposal:{slug}",
  "slug": "{slug}",
  "lifecycle": "draft",
  "revision": 1,
  "created_at": "ISO-8601",
  "updated_at": "ISO-8601",
  "title": "Decision-shaped title",
  "outcome": "Observable user outcome",
  "priority": "critical | high | medium | low",
  "size": "XS | S | M | L | XL",
  "labels": ["stable-label"],
  "source": {
    "kind": "groom-session",
    "session_id": "groom_...",
    "lineage": [{ "id": "source:...", "path": "pm/...", "sha256": "sha256:..." }]
  },
  "decision_brief": {
    "problem": "Evidence-backed pain and audience",
    "recommendation": "Smallest useful direction",
    "why_now": "Why this decision is timely"
  },
  "audience": [],
  "jobs_to_be_done": [],
  "evidence": [],
  "assumptions": [],
  "confidence": "high | medium | low",
  "scope": { "in_scope": [], "non_goals": [] },
  "requirements": [],
  "acceptance_criteria": [],
  "edge_cases": [],
  "design_requirements": [],
  "success_metrics": [],
  "alternatives": [],
  "risks": [],
  "open_decisions": [],
  "resolved_decisions": [],
  "question_reviews": [],
  "advisory_debt": [],
  "review": {
    "status": "pending",
    "revision": null,
    "content_sha256": null,
    "completed_at": null
  },
  "presentation": {
    "summary": "One-screen decision summary",
    "audience": "Who reviews this",
    "sections": ["decision-brief", "execution-contract", "appendix"]
  },
  "handoff": {
    "rfc_required": true,
    "implementation_ready": false,
    "dependencies": [],
    "constraints": []
  }
}
```

## Authoring guidance

### Stable IDs and lineage

Use typed stable IDs (`audience:`, `jtbd:`, `evidence:`, `assumption:`, `scope:`, `non-goal:`, `req:`, `ac:`, `edge:`, `design:`, `metric:`, `alternative:`, `risk:`, `decision:`, `review:`, `debt:`). References must resolve to the appropriate object. Evidence paths are project-relative and bounded; never write absolute paths, URLs masquerading as project evidence, or traversal.

### Decision Brief

Write for a human approving the product decision. State the pain, recommendation, why now, smallest scope, biggest risk, and remaining decision. Do not repeat the appendix.

### Execution Contract

RFC and Dev consume the structured scope, non-goals, requirements, acceptance criteria, edge cases, design requirements, dependencies, constraints, evidence, assumptions, and open decisions directly.

- Requirements describe observable product behavior, not chosen implementation.
- Acceptance criteria use Given/When/Then and reference the requirements they prove.
- Every non-goal includes the adjacent outcome intentionally excluded.
- Every open decision has a recommendation, owner, and decision boundary when the schema requires it.
- `implementation_ready` remains false until the required technical approval exists.

### Evidence and assumptions

Evidence records what was observed, where, and when. Assumptions state what is believed, confidence, and how to validate it. Never turn an assumption into evidence through confident prose.

### Review questions and advisory debt

Store answers from `review-questions.md` against the current revision and semantic content hash. Blocking answers prevent `reviewed`; advisory findings receive stable debt IDs and remain visible through approval/handoff.

## Human reader order

The generated HTML keeps three layers:

1. **Decision brief** — recommendation and approval boundary.
2. **Execution contract** — structured scope and acceptance content.
3. **Appendix** — evidence, audience/JTBD, design, alternatives, risks, decisions, review answers, and lineage.

Visible metadata includes lifecycle, approval state, revision, semantic content hash, source lineage, evidence freshness, and unresolved decisions. The reader must remain offline, inert, accessible, responsive, and printable.

## Legacy compatibility

Markdown-only proposals remain inspection-readable for List, Board, and migration. They do not gain trusted approval merely from `status: proposed`. RFC/Dev may use the legacy path only when no canonical JSON exists, and must label the handoff as legacy/unbound until the migration or explicit compatibility rule is satisfied.
