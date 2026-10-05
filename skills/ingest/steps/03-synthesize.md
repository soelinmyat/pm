---
name: Synthesize
order: 3
description: Cluster normalized evidence into customer outcome themes and write supported research artifacts
---

## Synthesize Research

## Goal

Turn normalized evidence into durable research artifacts and indexes that downstream PM skills can actually use.

## How

<HARD-GATE>
Synthesis is required after normalization. Do NOT skip because the record count is small.
Even 2-3 records can reveal a theme. Without synthesis, evidence stays in `{pm_state_dir}/` and never reaches `{pm_dir}/evidence/research/` — invisible to downstream skills.
</HARD-GATE>

**Load Hot Index** (pre-step).
Before clustering, load the hot index to identify existing insight topics for dedup and cluster naming.

```bash
# Check for hot index
if [ -f "{pm_dir}/insights/.hot.md" ]; then
  node ${CLAUDE_PLUGIN_ROOT}/scripts/hot-index.js --dir "{pm_dir}"
fi
```

- If `{pm_dir}/insights/.hot.md` exists, run `node ${CLAUDE_PLUGIN_ROOT}/scripts/hot-index.js --dir "{pm_dir}"` and parse the output table. Use existing insight topics to inform cluster naming (align new clusters with existing topic names where they overlap) and dedup (reuse an overlapping topic while incorporating the new observation and any contradiction; deduplicate repeated evidence identity, never discard new evidence because its topic is familiar). Log: "Hot index loaded ({N} insights)".
- If a match is found in the hot index, read the full insight `.md` file to confirm the overlap before merging or deduplicating.
- If `{pm_dir}/insights/.hot.md` does not exist, fall back to reading insight files directly (current behavior). Log: "Hot index not found, falling back to direct file scan".

Cluster records by user outcomes and context, including strengths, workarounds, constraints, and unmet needs; do not force a problem framing onto positive evidence or cluster solely by filenames or raw keywords.

Before publishing each topic, verify that its customer-sensitive sources have explicit review of their sanitized rendering. Pending records remain private and unbound; report the incomplete publication honestly. Ensure each reviewed normalized record contributing to the published topic is registered with `artifact_path: evidence/research/{slug}.md`. Keep each returned Evidence-ID with the claim it supports. A finding may cite multiple IDs; do not cite a whole source bundle when only one record supports the claim.

Granularity rule:
- cluster by the outcome the user wants
- not by broad category ("onboarding")
- not by atomized complaint fragments

Good themes:
- bulk-editing
- onboarding-friction
- reporting-gaps
- integration-fragility
- auditable-decisions (including successful value and conditions that preserve it)

Judge each claim using independent originating observations, claim fit, source credibility, segment coverage, selection bias, and counterevidence. Several records from one customer, repeated tickets about one incident, or derivative summaries do not independently corroborate prevalence. Report the sample and known denominator; when the denominator is unavailable, say so. Preserve important rare constraints when severity or recoverability makes them consequential.

Prioritize clusters by:
- frequency of independent observations (not files, quotes, or normalized record count)
- severity
- recency
- segment concentration
- strategic relevance to `{pm_dir}/strategy.md` if it exists

For audio-sourced records, use `speaker_role` to weight quote selection:
- Prefer `customer` quotes for pain points and representative quotes
- Use `interviewer` quotes only for context (what prompted the response)
- Keep unattributed speech `unknown`; do not count a leading prompt or ambiguous speaker as customer endorsement
- Link audio-sourced quotes to their transcript: `[View transcript]({pm_dir}/evidence/transcripts/{slug}.md)`

### Shared research knowledge base

Write durable outputs into the existing shared knowledge base:

```text
{pm_dir}/
  evidence/
    index.md
    log.md
    research/
      index.md
      log.md
      bulk-editing.md
    transcripts/
      log.md
    user-feedback/
      log.md
```

`$pm-ingest` and `$pm-research` share the `evidence/research/` pool. `$pm-ingest` also owns evidence-side pool bookkeeping.

After every successful write, update the relevant indexes and append touched paths to the matching logs:
- `{pm_dir}/evidence/index.md`
- `{pm_dir}/evidence/log.md`
- `{pm_dir}/evidence/research/index.md` and `{pm_dir}/evidence/research/log.md` when a research topic changes
- `{pm_dir}/evidence/transcripts/log.md` when a transcript file changes
- `{pm_dir}/evidence/user-feedback/log.md` when normalized feedback artifacts are emitted there

### `{pm_dir}/evidence/index.md`

Keep the top-level evidence index current. It is the shared entry point for all evidence pools.

Rules:
- Ensure the touched pool is represented under the correct section (`Research Evidence`, `Other Evidence Pools`, or future pool sections).
- Add or update the topic bullet when a research artifact changes.
- Preserve unrelated bullets and pool descriptions.
- Never remove another skill's entry unless the underlying file was intentionally deleted.

### `{pm_dir}/evidence/research/index.md`

Keep the research pool index current:

```markdown
# Index

| Topic/Source | Description | Updated | Status |
|---|---|---|---|
| [bulk-editing.md](bulk-editing.md) | Bulk Editing | 2026-03-12 | internal |
| [ai-pricing-models.md](ai-pricing-models.md) | AI Pricing Models | 2026-03-11 | external |
| [onboarding-friction.md](onboarding-friction.md) | Onboarding Friction | 2026-03-12 | mixed |
```

Rules:
- `Status` is `internal`, `external`, or `mixed`
- `Updated` should reflect the topic file's most recent evidence-aware date
- update only the row for the topic you touched
- never delete another skill's row content

### `{pm_dir}/evidence/research/{slug}.md`

Use this unified schema:

```markdown
---
type: evidence
evidence_type: research
topic: Bulk Editing
created: YYYY-MM-DD
updated: YYYY-MM-DD
source_origin: internal|external|mixed
provenance_version: 2
cited_by: []
sources:
  - label: support-export.csv
    rows: [12, 14, 31]
    imported: YYYY-MM-DD
evidence_count: 2 # distinct cited IDs; does not establish independent respondents
segments:
  - SMB
  - Mid-market
confidence: low # example only; justify the claim using its support and limitations
---

# Bulk Editing

## Summary
2-3 sentences on what this theme is and why it matters.

## Findings
- [internal] Evidence-backed finding. [evidence:ev_0123456789abcdef01234567]
- [internal] Weaker or contradictory signal, labeled with bounded confidence. [evidence:ev_89abcdef0123456789abcdef]

## Representative Quotes
> "Editing 50 rows one by one is painful."

## Confidence Notes
Explain originating observation independence, segment coverage, counterevidence, and the unknown denominator. Two cited IDs alone do not establish prevalence.

## Strategic Relevance
How this supports or challenges the current strategy.
If inferred, label it clearly.

## Implications
What this means for the product.

## Open Questions
What this research still does not answer.

## Source References
- `ev_0123456789abcdef01234567` — support-export.csv (row 14), imported 2026-03-12
```

Keep facts, hypotheses, and contradictions distinguishable. Prefix inference with `Hypothesis:` and retain conflicting evidence instead of averaging it away. `evidence_count` is the number of distinct cited Evidence-IDs, not the number of files or quotes.

### Mixed-origin write contract

When a topic already exists from `pm:research`, read and follow `${CLAUDE_PLUGIN_ROOT}/references/mixed-origin.md` for the full ownership and merge protocol.

### Post-write Validation

After writing or updating any `{pm_dir}/` artifacts, run:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/evidence.js validate \
  --pm-dir "{pm_dir}" --artifact "{pm_dir}/evidence/research/{slug}.md" --json
node ${CLAUDE_PLUGIN_ROOT}/scripts/validate.js --dir "{pm_dir}"
```

If either validation fails, repair the ledger, citation binding, or artifact before proceeding. Do not delete a finding merely to make validation pass; register its source correctly or move unsupported interpretation to Open Questions.

## Done-when

Evidence clusters are synthesized into canonical v2 artifacts with claim-level Evidence-ID citations; mixed-origin ownership is preserved; touched indexes and logs are current; evidence and PM validation pass.

**Advance:** proceed to Step 4 (Route Insights).
