# RFC Review Contract

## Goal

Return structured, evidence-backed technical verdicts for one exact RFC artifact hash.

## Required lenses

### `architecture-risk`

Check boundaries, data flow, security/reversibility risks, alternatives, migration/rollback, dependency order, and whether the architecture actually satisfies proposal ACs.

### `test-strategy`

Read `skills/dev/test-layers.md`. Check all five Test Strategy blocks, concrete layer selection, new infrastructure, non-empty regression surface, executable verification commands, open questions, and per-issue Test hook → AC traceability. Missing, vague, invented, or checkbox-everything hooks are blocking.

### `maintainability`

Check complexity, reuse, file responsibilities, operational burden, implementation granularity, cross-boundary sync, and whether the issue split creates independently testable working increments.

## Process shape

The lenses are mandatory; the process count is adaptive:

- One cohesive issue with low cross-cutting risk: one reviewer may return all three lens objects.
- Multiple issues or meaningful architecture/test independence: use independent reviewers in parallel.
- Three or more substantial dependent issues: add the cross-cutting architecture, integration, and scope reviewers from `cross-cutting-reviewers.md`.

Never split only to create activity. Never combine lenses when shared context would cause correlated blind spots.

## Verdict schema

Return one object per required lens:

```json
{
  "lens": "architecture-risk",
  "artifact_hash": "sha256:...",
  "verdict": "pass",
  "blocking": [],
  "advisory": [
    {
      "summary": "Keep rollback command in the execution contract",
      "evidence": "RFC section/anchor or source path",
      "remediation": "Exact document change"
    }
  ]
}
```

`artifact_hash` is the combined HTML/sidecar fingerprint from the review packet. Every required lens must return the same current fingerprint. `verdict` is `pass` or `block`. A passing lens has an empty `blocking` array. Findings cite RFC/source evidence and a bounded remediation. Praise, narrative summaries, and silence are not verdicts.

## Fix loop

Merge and deduplicate findings by violated contract and evidence. Apply blocking fixes, regenerate mirrored sidecar content and binding, commit the pair, then rerun affected lenses against the new hash. Two fix rounds maximum. Advisory findings remain attributed in the RFC.

Technical review never creates new human approval. Review completion means all three required lens objects pass against the same current artifact hash. Initial/material design is **reviewed and awaiting approval**, never newly human-approved. For in-scope maintenance, read `maintenance.md`: each lens adds `maintenance_scope: { preserved: true, rationale: "specific constraint/source and why the change preserves behavior, scope and significant risk" }`. A material change, weakened test obligation or unresolved boundary blocks maintenance. Passing review retains the original decision and proceeds to a distinct maintained handoff; it grants no external authority.
