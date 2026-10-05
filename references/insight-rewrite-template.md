# Insight Reader and Synthesis Contract

Routing preserves the analyst body and updates its managed Source Digest. The source digest contains complete source context and exact caller-selected claims; it is not a semantic conclusion. Never turn the first finding of a multi-topic file into the finding for every linked insight.

## Analyst synthesis

An authored assessment answers one product question for a named segment and context. Explain what evidence changes the recommendation, what alternatives or counterevidence remain credible, and what observation would reverse it. Integrate relevant findings without erasing contradictions, old superseded claims, or the limits of a single upstream observation.

Each consequential claim cites an exact source finding/paragraph and its portable path, preserving Evidence-ID markers. A source file can contain many independent questions; different files can repeat the same upstream claim. File count does not calibrate confidence.

Structured analyst input to `scripts/insight-rewrite.js` includes `summary`, `claims` with exact `evidence_refs` (`path`, `finding`), `confidence` (`level`, `basis`, `limitations`), and `open_questions`. Read `${CLAUDE_PLUGIN_ROOT}/references/insight-routing.md` for the full example. The helper checks excerpt bindings and renders the supplied assessment. It never certifies entailment or invents the analysis.

## Confidence Rationale

Always state the claim's support and unresolved limitation, including at low confidence. Judge authority, independent upstream origins, recency, and claim fit. A current primary source can establish a fact it controls; it cannot establish customer demand or causality merely because several summaries repeat it.

Example: “Low confidence: one supervisor team directly demonstrated task-location failures. The problem beyond that team, and whether a persistent entry solves it, remain unknown.” Do not replace this with “four source files support multiple angles.”

## Source Digest

The helper-owned block is labeled Source Digest and includes source snapshots, selected findings, complete source context, and a visible statement that synthesis is pending. It retains later contradictory findings, source references, and custom counterevidence. Do not hand-edit its managed markers or promote draft/stale insight from a digest alone. Outside this block, preserve analyst text unless deliberately revising it through the owning workflow.

When a source changes at the same path, its snapshot changes. Prior conclusions remain visible but become stale, `synthesis_state: needs-synthesis`, and low confidence until reconsidered. A selected finding removed from the current source is retained historically rather than silently treated as current support. Relevance and independent support require judgment, not a changed filename or a larger source array.
