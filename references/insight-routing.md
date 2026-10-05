# Insight Routing

Shared reference for Research, Ingest, Refresh, and durable decision/implementation findings. Routing makes evidence discoverable; it does not establish that a claim is true or synthesize a product decision.

## Inputs and source selection

Read the source and the target insight before proposing a route. Compare the actual product question, segment, situation, and supported claim; keyword overlap only suggests a place to inspect. Evidence that contradicts an insight belongs beside supporting evidence, with the disagreement visible.

Use canonical source paths under `evidence/`. The existing landscape input `insights/business/landscape.md` is also supported. Never route an insight into itself; source and target paths must differ. Competitor artifacts and indexes retain their original type and provenance; do not relabel them merely to route them.

For each route, name the exact finding that relates to the topic, including its Evidence-ID markers. Pass complete finding text in `selected_findings`. On sources without a Findings section, use an exact source paragraph. Selection is supplied by the analyst, never inferred from the finding's position. Do not choose only agreeable evidence; inspect later findings, superseded claims, segment differences, and counterevidence.

```json
{
  "routes": [{
    "mode": "existing",
    "evidencePath": "evidence/research/team-requests.md",
    "insightPath": "insights/product/request-discoverability.md",
    "description": "Supervisors lose the team context when opening a request",
    "selected_findings": [
      "[internal] Supervisors cannot locate Time off from Team. [evidence:ev_0123456789abcdef01234567]"
    ]
  }]
}
```

Apply accepted routes with `node ${CLAUDE_PLUGIN_ROOT}/scripts/insight-routing.js --pm-dir "{pm_dir}"`, passing JSON on stdin. Existing callers may omit `selected_findings`; this links the source and creates a complete source digest, but leaves relevance and synthesis explicitly pending. A selected excerpt no longer present in the current source is an error, not permission to silently pick the first finding.

## Finding topics

Discover domains from `insights/*/index.md` and read the relevant flat `type: insight` topics. Match questions and meaning, not source counts. If no suitable topic exists, propose a named topic and domain from the finding. When strategy exists and a domain is empty, up to six specific falsifiable strategy claims may seed draft topics; mark these as assumptions with no routed evidence. A strategic commitment is not customer-demand evidence.

Present proposed existing/new routes together with their source, selected claim, and relevance or contradiction. Preserve the caller's scope and existing user confirmation convention; routing does not authorize unrelated knowledge-base edits.

The optional `insight-route-suggestions.js` helper ranks lexical candidates only. Its `selection_required` flag means the author must inspect relevance. Already-linked sources with changed or missing snapshots are surfaced even if keywords disappeared, because the earlier conclusion may no longer hold. All changed-source dependents are returned; the lexical suggestion cap applies only to new matches. Do not interpret a suggestion score as support or semantic confidence.

## Writes and ownership

The routing helper owns citation backlinks, source links, domain indexes/logs, and hot-index regeneration. It writes only `cited_by` on evidence artifacts, preserving origin, internal quotes, evidence counts, source confidence, and source references. A source may support several topics without becoming several independent observations.

For new topics, save draft/low with `synthesis_state: needs-synthesis`. Existing source links are deduplicated, but unchanged filenames do not prove unchanged meaning. The helper records `source_snapshots` using fingerprints of source content and metadata excluding citation backlinks. A changed or previously unrecorded snapshot, or changed selected finding, updates the digest and marks prior active insight stale/low with `synthesis_state: needs-synthesis`. No confidence increase follows file count. Unchanged linked source content is idempotent.

Newly routed topics receive the same complete source digest as existing topics; they do not wait for a second source to become readable. Source excerpts retain later claims, uncertainty, contradiction, original Evidence-ID markers, and source references. `source_claims` retains exact selections per source; an old selected claim removed during refresh is shown as historical and needs reconciliation.

A failure is reported per route/insight while unaffected work is preserved. Inspect returned errors; do not claim synthesis complete merely because links or validation succeeded. Index status reflects the resulting draft/stale/current insight, rather than the pre-refresh status.

## Step 5.5: Evidence changes and analyst synthesis

Read `${CLAUDE_PLUGIN_ROOT}/references/insight-rewrite-template.md` for the reader contract. `scripts/insight-rewrite.js` now refreshes a managed **Source Digest** and preserves existing analyst body. It does not mechanically replace interpretation with a first sentence per file. A digest is source context, not an evolving semantic synthesis.

Before reusing a `needs-synthesis` or stale insight for Think, Strategy, Ideate, or Groom, inspect the current selected claims and source context. Reconsider the product conclusion against authority, independent upstream origins, recency, exact claim fit, segment boundaries, and contradictory evidence. Keep uncertainty explicit when a supported conclusion cannot be reached. Read the linked source itself when excerpts cannot establish the context.

An analyst may supply structured synthesis to the same helper:

```json
{
  "insights": [{
    "insightPath": "insights/product/request-discoverability.md",
    "synthesis": {
      "summary": "Test a persistent Team entry with the supervisors who reported losing the request destination; demand outside this segment is unknown.",
      "claims": [{
        "text": "The observed discoverability problem affects these supervisors, not necessarily every user.",
        "evidence_refs": [{
          "path": "evidence/research/team-requests.md",
          "finding": "[internal] Supervisors cannot locate Time off from Team. [evidence:ev_0123456789abcdef01234567]"
        }]
      }],
      "confidence": {
        "level": "low",
        "basis": "Direct observation supports the reported task friction in this segment.",
        "limitations": "One upstream customer group; broader prevalence and improvement from the proposed entry remain untested."
      },
      "open_questions": ["Does a persistent entry reduce task-location failures for these supervisors?"]
    }
  }]
}
```

Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/insight-rewrite.js --pm-dir "{pm_dir}"` with this JSON on stdin. Exact source-excerpt binding is checked before writing; it is not entailment or independent quality certification. The helper labels the supplied assessment Reviewed Synthesis, preserves earlier analyst body as historical context, and records `synthesis_state: reviewed`, active status, and the supplied confidence. Low confidence remains legitimate and always has a visible basis and limitation. Later source changes invalidate that assessment's currentness until reconsidered. The standalone CLI projects successful changes into the domain index and hot index, preserving existing index descriptions. The programmatic helper returns per-insight changes; its routing caller owns those projections.

## Completion

Validate touched project artifacts with `scripts/validate.js --dir "{pm_dir}"` and the caller's Evidence v2 checks. Validation establishes schema/provenance consistency, not semantic quality. Report linked sources, changed-source conclusions needing reconsideration, supplied assessments, errors, and unresolved limitations honestly. Do not report source digest generation as completed product synthesis.
