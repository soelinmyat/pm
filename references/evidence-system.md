# Evidence System v2

Shared deterministic contract for `pm:note`, `pm:ingest`, `pm:research`, and `pm:refresh`.

## Boundary

The evidence runtime owns identity, hashes, portable provenance, privacy state, transformations, revisions, citation bindings, staleness projection, compare-and-swap refresh, locking, and atomic ledger publication. Skills own source interpretation, normalization quality, synthesis, confidence, contradictions, research mode, and refresh scope.

Do not use the runtime as a generic workflow engine. It does not decide whether a source is credible or whether a finding should change product strategy.

## Storage

```text
.pm/
  evidence/
    records/       # private normalized records and raw locators
    conflicts/     # proposed refreshes rejected by compare-and-swap
  imports/         # private raw import manifest
{pm_dir}/
  evidence/
    provenance.json  # committed portable ledger
    notes/
    research/
    competitors/
    transcripts/
    user-feedback/
```

Never place absolute paths, raw customer content, account identifiers, or unrestricted private quotes in `provenance.json`. Private records may point to local inputs; committed records use portable `source_label` values such as `support-export.csv` or `example.com/pricing`.

## Identity and revisions

`evidence_id` is `ev_` plus the first 24 hexadecimal characters of SHA-256 over normalized `source_type`, portable `source_label`, and `locator`. Mutable content is not part of identity. The exact normalized content is represented by `content_sha256`.

Registering the same ID and content hash is idempotent. Registering or refreshing changed content keeps the ID, appends the prior hash and timestamps to `revisions`, and publishes the new current hash. No command silently removes a record or revision.

## Privacy

Classifications are `public`, `internal`, `customer-sensitive`, and `restricted`. PII review states are `not-required`, `pending`, and `reviewed`. Customer-sensitive or restricted evidence may not claim `not-required`.

The ledger stores classification and review state, not the sensitive body. A pending record can be captured and synthesized privately, but the user still receives the explicit PII review warning before committing reader artifacts. `artifact_paths` is an append-only set: one source may support several reader artifacts without duplicating its Evidence-ID.

## Transformations

Stages are `captured`, `normalized`, and `synthesized`. A transformed record lists its parent evidence IDs and method. Parent IDs must exist in the same ledger. This forms an inspectable lineage from source capture through normalized evidence to a durable research finding without embedding raw content in the committed manifest.

## Commands

All mutation requests come from a JSON request file so source text is never interpolated into shell code.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/evidence.js" register \
  --pm-dir "{pm_dir}" --private-dir "{pm_state_dir}" \
  --request "{pm_state_dir}/evidence/register.json" --json

node "${CLAUDE_PLUGIN_ROOT}/scripts/evidence.js" refresh \
  --pm-dir "{pm_dir}" --private-dir "{pm_state_dir}" \
  --request "{pm_state_dir}/evidence/refresh.json" \
  [--artifact "{pm_dir}/evidence/research/topic.md"] --json

node "${CLAUDE_PLUGIN_ROOT}/scripts/evidence.js" validate \
  --pm-dir "{pm_dir}" [--artifact "{pm_dir}/evidence/research/topic.md"] --json

node "${CLAUDE_PLUGIN_ROOT}/scripts/evidence.js" audit \
  --pm-dir "{pm_dir}" --json
```

`refresh` requires `observed_content_sha256`. When `--artifact` is supplied, the request also requires `observed_artifact_sha256`, computed from the exact file read during audit. If either observed hash no longer equals current state, the command exits with code 3, leaves the ledger and artifact untouched, and saves the proposed request under `{pm_state_dir}/evidence/conflicts/` for reconciliation.

## Citation binding

Research upgraded to v2 declares `provenance_version: 2` in frontmatter. Every bullet in `## Findings` carries at least one `[evidence:ev_<24 hex>]` marker. `evidence.js validate --artifact` requires each ID to exist and bind to that artifact.

Legacy artifacts without `provenance_version: 2` remain readable. When Research or Refresh materially changes a legacy artifact, register the sources, add v2 finding citations, then validate the touched artifact. Do not perform an eager whole-KB rewrite.

## Freshness

The executable threshold table lives in `scripts/lib/evidence-schema.js` and is documented by `skills/refresh/references/staleness-thresholds.md`. Audit returns the evidence ID, observed timestamp, threshold, age in whole days, and `fresh`, `aging`, or `stale` state. Skills may pass project overrides, but must report the applied threshold rather than silently changing it.
