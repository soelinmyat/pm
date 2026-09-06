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
{IF verify mode} **Previous findings:** Read only the exact earlier findings materialized by the hash-bound `prior_findings_source`; its rows must exactly match `prior_finding_refs`.

Follow the tiered methodology: data-backed (Tier 1) before screenshots (Tier 2) before subjective (Tier 3).

Calibrate severity by user impact. Objective defects can block when they violate an applicable requirement or prevent the job; subjective craft concerns stay P2/P3 unless independent evidence shows user confusion or task failure. Missing intent is uncertainty to record, not permission to invent a P1.
```

Return only the ID-free Primary raw result payload described here; do not add prose outside it. The payload has exactly `summary`, `scores`, and `findings` at the top level. `summary` is an evidence-based overall assessment of 1 to 10,000 UTF-8 bytes, `scores` is the closed mode-specific object below, and `findings` is an array.

The score keys are closed by mode:

```json
{
  "product-ui": [
    "hierarchy",
    "density",
    "consistency",
    "accessibility",
    "responsive",
    "state-clarity"
  ],
  "pm-artifact": [
    "hierarchy",
    "density",
    "consistency",
    "accessibility",
    "responsive",
    "print-navigation"
  ]
}
```

Return every key for the selected mode and no score key from the other mode. Every score is a closed object with exactly these fields:

```json
{
  "value": 4,
  "rationale": "Concrete evidence-based rationale.",
  "evidence_ids": ["supplied-evidence-id"]
}
```

`value` is an integer from 1 through 5. `rationale` is a concrete explanation of 1 to 10,000 UTF-8 bytes. `evidence_ids` is a non-empty unique array of at most 400 IDs containing only capture or normalized evidence IDs supplied to this Primary invocation. Cite the full checker-required evidence set: all active captures for `hierarchy`, `density`, and `state-clarity`; every supplied accessibility-tree audit for `accessibility`; every applicable responsive capture plus the supplied DOM audits (`product-ui`) or artifact renders (`pm-artifact`) for `responsive`; supplied DOM audits for product-UI `consistency`; supplied artifact-structural and artifact-render evidence for artifact `consistency`; and every print capture plus supplied artifact-structural and artifact-render evidence for `print-navigation`.

Each raw finding omits `id` and contains exactly `subject_id`, `region`, `rule`, `coverage_ids`, `evidence_ids`, `priority`, `owner`, `basis`, `confidence`, `summary`, `impact`, and `remediation`. `subject_id` references a routed subject. `region` and `rule` are stable kebab-case tokens. `coverage_ids` is a non-empty unique array of at most 100 of that subject's supplied coverage IDs. `evidence_ids` is a non-empty unique array of at most 400 supplied Primary evidence IDs for that subject. `priority` is `P0`, `P1`, `P2`, or `P3`; `owner` is `design-critique`, `qa`, or `review`; `basis` is `objective`, `craft`, or `uncertain`; and `confidence` is `high`, `medium`, or `low`. `summary`, `impact`, and `remediation` each contain 1 to 10,000 UTF-8 bytes. Return no more than 50 findings, and do not return two findings with the same subject, region, rule, coverage, and evidence identity.

### Caller normalization and receipt binding

The reviewer does not create finding IDs. The caller passes the raw payload and bound review context through `normalizePrimaryReviewResult` from `scripts/lib/design-critique-review-result.js`. That production helper rejects invalid raw fields, copies the payload without rewriting or reordering reviewer-authored values, and inserts one deterministic `id` into every finding. The ID is `drf-` plus the first 16 lowercase hexadecimal characters of SHA-256 over canonical JSON containing:

```json
["<review_id>", "<subject_id>", "<region>", "<rule>", ["<sorted coverage_id>"], ["<sorted evidence_id>"]]
```

Sorting in the identity input is lexicographic and does not change the stored arrays. The resulting normalized finding contains exactly `id` plus the 12 raw fields above. That normalized payload—not the transient ID-free response—is the Primary `result` stored in `reviews.json`. The caller computes `result_sha256` over the canonical JSON bytes of this normalized stored result. The exact closed receipt stores `prompt_sha256` and `input_payload_sha256`—the latter already binds `prompt_profile`—along with the result hash, review/perspective identity, context/invocation IDs, assurance, and timestamps; it does not add a `prompt_profile` field. If validation or normalization fails, reject the response; do not guess or edit substantive reviewer output. The assurance is `workflow-attested-non-cryptographic`: the receipt is an audit record, not a signed provider proof.

---

## Verify Mode (re-invocation after fixes)

Same dispatch, with these additions:

- Receive `prior_finding_refs` plus a separate hash-bound `prior_findings_source` that materializes exactly those complete earlier findings. Do not accept an unbound prose copy or add finding bodies directly to the closed review input.
- The reviewer checks whether each prior finding was addressed and flags regressions.
- New findings are treated the same as first-round findings.
