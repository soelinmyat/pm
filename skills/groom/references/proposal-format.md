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

Lifecycle-only changes advance monotonically (`approved → planned → in-progress → done`) while keeping the revision and semantic content hash. At `approved`, the audit must match the exact current bytes. Later lifecycle bytes differ by definition, so consumers verify the original approved-byte hash plus the unchanged revision, semantic content hash, and session decision identity. For current proposals, the decision ID and hash are canonically derived from the bound Groom session, proposal revision/content, completed review identity, approver, and approval time; arbitrary well-formed constants never establish approval. A substantive edit increments `revision`, clears current review/approval, and returns to the earliest affected Groom phase. Never infer approval from a Markdown status.

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
    "lineage": [{ "id": "source:...", "path": "backlog/...", "sha256": "sha256:..." }]
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
  "design_context": {
    "design_requirements": ["Exact requirement text copied from design_requirements"],
    "ui_impact": true,
    "prototype": {
      "path": "pm/backlog/wireframes/{slug}.html",
      "sha256": "sha256:{hash-of-current-prototype-bytes}"
    },
    "critical_states": ["loading", "empty", "error", "success"],
    "experience_invariants": ["User-observable property technical tradeoffs must preserve"],
    "visual_invariants": ["Implementation constraint that must survive technical tradeoffs"]
  },
  "success_metrics": [],
  "alternatives": [],
  "risks": [],
  "open_decisions": [],
  "resolved_decisions": [],
  "review_contract": {
    "session_id": "groom_...",
    "tier": "quick | standard | full | agent",
    "required_question_ids": ["exact IDs from session.routing.review_questions"]
  },
  "question_reviews": [
    {
      "id": "review:scope",
      "question_id": "scope",
      "question": "Exact canonical question text",
      "conclusion": "Decision reached",
      "rationale": "Why it follows",
      "outcome": "pass | advisory | fail",
      "evidence": [
        {
          "evidence_id": "evidence:registered-id",
          "locator": "Precise section, row, finding, or line",
          "relevance": "How this location bears on this answer"
        }
      ],
      "confidence": "high | medium | low",
      "finding": null,
      "advisory_debt_ids": []
    }
  ],
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
- `design_context.design_requirements` exactly mirrors the ordered requirement text from `design_requirements`; this gives RFC and Dev one closed object to copy without discarding the stable proposal IDs.
- `ui_impact` is explicit. Visual UI work sets it to `true`; nonvisual API, CLI, worker, or operator work sets it to `false` rather than inventing a layout concern.
- `prototype` is explicitly `null` for nonvisual work or when no prototype was approved. Otherwise its normalized project-relative path and SHA-256 bind the exact entry file. Multi-file prototypes also carry the sorted bounded `manifest` produced by `scripts/prototype-identity.js`, whose `tree_sha256` binds every file under the prototype directory. The checker recomputes the identity whenever it has repository context; a plausible-looking hash is not evidence.
- `critical_states` names the states implementation and QA must exercise. `experience_invariants` records user-observable behavior technical tradeoffs must preserve. Visual work additionally supplies concrete hierarchy, responsive, accessibility, and interaction properties in `visual_invariants`; nonvisual work uses an empty `visual_invariants` array.
- `implementation_ready` remains false until the required technical approval exists.

### Evidence and assumptions

Evidence records what was observed, where, and when. Every current evidence path resolves to a retained regular, non-symlink file inside the project and to a matching hash-bound `source.lineage` row. The reader checks at most 64 retained source paths, with an 8 MiB per-source limit and a 32 MiB aggregate read limit. Each path consumes aggregate budget independently, including multiple paths hard-linked to the same inode. Review locators must use a bounded line range, Markdown heading, JSON Pointer, unique stable marker such as `F3`, or a specific phrase that occurs on exactly one line; short/common substring and ambiguous multi-match locators do not count. Retained located content is capped at 64 KiB. Binary formats remain hash-bound even when their internal locator cannot be checked without a format-specific reader. The located text must have a concrete lexical connection to both the answer and its relevance explanation—this catches unrelated-source rubber stamps without claiming that token overlap proves the product conclusion. Assumptions state what is believed, confidence, and how to validate it. Never turn an assumption into evidence through confident prose.

### Review questions and advisory debt

Copy `review_contract.session_id`, `tier`, and the ordered `required_question_ids` from the trusted Groom session during Draft. Each completed `question_reviews` row records that exact `question_id` and uses `id: review:{question_id}`. Keep the decision-bearing `conclusion` separate from its `rationale`; neither may merely restate the canonical question. Bind each answer to registered evidence with a precise locator and answer-specific relevance. Review passes only when the rows exactly cover the frozen contract, their answers and evidence explanations are independent, and the phase result matches the canonical rows exactly. Failing answers prevent `reviewed`; advisory findings receive stable debt IDs and remain visible through approval/handoff.

## Human reader order

The generated HTML uses the shared readable-artifact rules in `references/writing.md`:

1. **Decision brief / Overview** — one recommendation, problem and timing, scope, material risks, and open decisions. Approval status remains visible above this section.
2. **Mockups** — the source-bound prototype link and critical states, after the product context and before implementation detail. No linked prototype means an honest empty state, never invented approved visuals.
3. **Execution Contract** — one complete requirements/acceptance/design/dependency reader in a native disclosure. RFC and Dev still consume canonical JSON.
4. **Evaluation** — success measures and alternatives.
5. **Appendix / Evidence and review** — audience/jobs, source provenance, assumptions, confidence, and review records in a native disclosure.

Use an H1 title, H2 groups, and H3 subsections with matching two-level navigation outside disclosures. Preserve stable section IDs. Do not repeat the recommendation or flatten the entire contract into a second summary table. All source content remains available; neither compact presentation nor a word budget changes the approval boundary.

Prototype HTML remains a separate source-bound document. Never inject its HTML, executable content, or an iframe into the inert proposal reader. A linked prototype is not proof of approval: show the actual proposal approval verification separately. Annotated screen previews belong in the prototype, with a short caption, numbered callouts, and explicit state labels. Do not reproduce private example data in public reference artifacts.

Visible metadata includes lifecycle, verified approval state only when a matching audit was supplied, revision, content identity, source lineage, evidence freshness, UI-impact classification, invariants, complete prototype identity, and unresolved decisions. Retain integrity details in the appropriate evidence/design sections. The reader remains offline, inert, accessible, responsive, and printable.

## Legacy compatibility

Markdown-only proposals remain inspection-readable for List, Board, and migration. They do not gain trusted approval merely from `status: proposed`. RFC/Dev may use the legacy path only when no canonical JSON exists, and must label the handoff as legacy/unbound until the migration or explicit compatibility rule is satisfied.

Canonical schema-v1 proposals created before `design_context` remain readable, but they cannot start a new RFC from reconstructed sidecar prose. Return them to Groom for a substantive revision that records and approves the durable context.

Earlier design contexts without `ui_impact`/`experience_invariants` remain inspection-readable. An earlier multi-file prototype binding without a tree manifest is incomplete evidence and must be substantively revised and re-approved before current RFC/Dev intake.

Canonical schema-v1 proposals created before `review_contract` also remain inspection-readable and are reported as `legacy-unbound-review-contract`. They cannot satisfy the current Groom quality or approval gate, or enter a new RFC/Dev session as trusted product approval, until a current Groom session binds evidence, tier, exact required question IDs, and a fresh review.

## Bounded delivery approval

The proposal remains the product contract; its sibling `.approval.json` may optionally carry the runner-produced `delivery_delegation`. It is recorded only by the explicit product approval command with `--delegate-content-sha256` matching the reviewed canonical content hash. The grant binds the Groom run/source base, proposal ID/revision/content/snapshot, original approver/time, fixed material boundaries and `technical_derivation: true`, `implementation: true`. Its `grant_sha256` participates in the original decision digest. RFC and Dev consume the verified audit and canonical session, never an editable boolean in proposal facts. Absence preserves the ordinary human RFC decision. The grant does not authorize tracker writes, shipping, deployment or platform permission.
