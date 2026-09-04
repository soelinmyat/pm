# Groom Review Questions

Review proposal decisions through independent questions. A runtime may answer them inline or distribute them to available workers. Never encode correctness as a fixed worker count or persona list.

## Canonical required question IDs

The following IDs are the current executable review contract. Copy the selected tier's ordered list exactly into `review_contract.required_question_ids`; `agent` intentionally uses the same required questions as `full`.

<!-- canonical-review-question-ids -->

```json
{
  "quick": ["assumption-risk", "experience"],
  "standard": ["problem-evidence", "scope", "acceptance", "experience", "feasibility"],
  "full": ["problem-evidence", "scope", "acceptance", "experience", "feasibility", "reversal"],
  "agent": ["problem-evidence", "scope", "acceptance", "experience", "feasibility", "reversal"]
}
```

## Required questions

### `quick`

- **`assumption-risk`:** Which evidence gap or assumption is most likely to reverse this recommendation?
- **`experience`:** Are the primary experience, consequential states, and design requirements complete?

### `standard`

- **`problem-evidence`:** Is the problem and evidence chain sufficient for this decision?
- **`scope`:** Is the scope coherent, minimal, and explicit about non-goals?
- **`acceptance`:** Are acceptance criteria observable and implementation-neutral?
- **`experience`:** Are user flows, failure states, and design requirements complete?
- **`feasibility`:** Is feasibility credible without smuggling in an engineering design?

### `full` and `agent`

Use every `standard` question plus:

- **`reversal`:** What assumption, counterexample, or competitive fact could reverse the recommendation?

The `agent` tier tightens freshness and citation expectations inside these answers. Citation integrity is not a seventh required question in the current schema-v2 contract.

## Optional advisory enrichment

Reviewers may examine these dimensions when they materially improve the decision, but they are not tier-required question IDs:

- **Competitive/strategy fit:** Does the scope support current strategy and accurately characterize parity, table stakes, gap-fill, or differentiation?
- **Measurement:** Can success metrics distinguish feature failure from upstream/downstream causes?
- **Adversarial assumption:** What plausible counterexample, misuse, permission boundary, or operational constraint would make the proposal wrong?
- **Citation integrity:** Are sampled citations real, current, correctly attributed, and sufficient for the decisions they support?

Capture useful results as advisory findings outside `question_reviews`. Promoting any of these dimensions into `review_contract.required_question_ids` requires a coordinated session-schema/runtime migration; do not add them ad hoc to a schema-v2 proposal.

## Result contract

Each required answer contains:

```json
{
  "question_id": "scope",
  "verdict": "pass | advisory",
  "conclusion": "The decision reached for this question",
  "rationale": "Why the proposal and cited evidence support that conclusion",
  "evidence": [
    {
      "evidence_id": "evidence:customer-signal",
      "locator": "F3 or another precise location",
      "relevance": "How this location bears on this answer"
    }
  ],
  "confidence": "high | medium | low",
  "finding": null
}
```

`conclusion` answers the question; it must not copy or lightly rearrange the question. `rationale` is a separate explanation, not a confidence adjective or restatement. Evidence points to a registered proposal evidence ID and a precise locator, then explains its answer-specific relevance. A low-confidence conclusion cannot pass silently: record it as `advisory` with a concrete `finding` and tracked debt.

Raw reviewer inputs may still raise blocking concerns or disagree. Normalize only after every dispute is explicitly resolved and no `blocking` answer remains. The canonical proposal uses `outcome` in place of the phase result's `verdict`, with the same conclusion, rationale, evidence, confidence, and finding bytes. Review passes only when every routed question has a current matching answer for the frozen proposal revision/hash and no failing answer remains. Advisory findings stay visible in the proposal, generated HTML/Markdown, and handoff.
