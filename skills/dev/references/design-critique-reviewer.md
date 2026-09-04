# Design Reviewer Dispatch

Single reviewer dispatch context. The reviewer uses hard data (a11y snapshots, visual consistency audit) for HIGH confidence findings.

---

## Primary Review

**Agent persona:** `@designer`

Dispatch with this context:

```
Review these screenshots for visual quality, accessibility, design system compliance, and interaction resilience.

**Screenshots:** Read only the capture IDs frozen in the hash-bound round capture manifest.
**Manifest:** Read the hash-bound `route.json`, `captures.json`, shared review context source, and round capture manifest from the same directory. The shared context source is the only source for the page brief and design principles.
**Accessibility snapshots:** Read only the normalized `accessibility-tree` evidence IDs supplied to this review. For product UI, every capture cited by an eligible audit is in the bound round manifest; for PM artifacts, a document-wide audit is eligible only when all of its cited captures are in that manifest. Use the retained element roles, accessible names, ARIA states, and focus-order evidence for concrete [HIGH] confidence accessibility findings; do not infer a clean tree merely from a passing summary boolean.
**Visual consistency audit:** Read only the normalized `dom-audit` evidence IDs supplied to this review; every capture they cite is in the bound round manifest. These group elements by visual role (headings, buttons, cards, siblings) and flag variance within each group — plus overflow, asymmetric padding, and edge-alignment drift. Treat measured overflow and edge-alignment rows as data-backed [HIGH] confidence findings when sibling component edges or popover/menu trailing controls differ by >=2px. For PM artifacts, read only supplied render evidence whose full-page and print bindings exactly match the round capture set. Remember: these are NOT automatically token compliance issues (linters catch those). These are cases where valid tokens can still produce inconsistent visual results.
**Design principles:** Read the bound shared context source; do not reread mutable project prose after dispatch starts.
**Ticket context:** {ticket/issue description or PM context}
{IF verify mode} **Previous findings:** {insert previous round findings for comparison}

Follow the tiered methodology: data-backed (Tier 1) before screenshots (Tier 2) before subjective (Tier 3).

Calibrate severity by user impact. Objective defects can block when they violate an applicable requirement or prevent the job; subjective craft concerns stay P2/P3 unless independent evidence shows user confusion or task failure. Missing intent is uncertainty to record, not permission to invent a P1.
```

Return only the Primary `result` object required by `reviews.json`:

```json
{
  "summary": "Evidence-based overall assessment.",
  "scores": {
    "hierarchy": {
      "value": 4,
      "rationale": "Concrete rationale.",
      "evidence_ids": ["capture-id"]
    }
  },
  "findings": []
}
```

Include all six mode-specific score keys. Each finding uses exactly `id`, `subject_id`, `region`, `rule`, `coverage_ids`, `evidence_ids`, `priority`, `owner`, `basis`, `confidence`, `summary`, `impact`, and `remediation`. `region` and `rule` are stable kebab-case tokens. `basis` is `objective`, `craft`, or `uncertain`; `confidence` is `high`, `medium`, or `low`. Use no more than 50 findings. The caller computes deterministic IDs, records the exact input/result hashes, and writes a durable execution receipt that binds the prompt profile, context/invocation IDs, and timestamps. The assurance is `workflow-attested-non-cryptographic`: the receipt is an audit record, not a signed provider proof. Do not add prose outside the result object.

---

## Verify Mode (re-invocation after fixes)

Same dispatch, with these additions:

- Include the previous round's findings for comparison.
- The reviewer checks whether each prior finding was addressed and flags regressions.
- New findings are treated the same as first-round findings.
