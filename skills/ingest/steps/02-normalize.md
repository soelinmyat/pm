---
name: Normalize
order: 2
description: Normalize private evidence records and register portable Evidence v2 provenance
---

## Normalize Evidence

## Goal

Convert accepted inputs into private normalized records plus idempotent, portable Evidence v2 ledger entries that synthesis can cite without exposing customer content or local paths.

## How

Read `${CLAUDE_PLUGIN_ROOT}/references/evidence-system.md` and use its request-file CLI contract. Keep the existing `.pm/imports/manifest.json` for file-level SHA, column mappings, and import state; Evidence v2 adds record-level identity, lineage, revisions, privacy state, and citation bindings.

```text
.pm/
  imports/
    manifest.json                  # private file-level import state
  evidence/
    records/
      ev_<id>.json                 # private normalized content and local locator
    conflicts/                     # rejected refresh proposals
    requests/                      # transient JSON command requests
    transcripts/
      interview.txt                # raw transcript
{pm_dir}/
  evidence/
    provenance.json                # portable committed ledger
    transcripts/
      interview.md                 # redacted reader artifact
```

Private normalized records are written to `{pm_state_dir}/evidence/records/` with mode `0600`; the CLI creates this path. For each reliable evidence item:

1. Preserve the extracted fields privately: `topic`, `pain_point`, `summary`, a short quote when useful, local source path, and raw row/section/timestamp locator.
2. Choose portable source labels via `source_label`, such as a basename or host/path; never put an absolute path, account name, or raw quote in the ledger.
3. Build one JSON request under `{pm_state_dir}/evidence/requests/` with:
   - `source_type`: `interview|support|sales|feedback|unknown` (`notes` from legacy ingest maps to `feedback`);
   - `source_format`: `md|txt|csv|json|audio|unknown`;
   - stable `locator`: `row:14`, `section:Pain points`, `timestamp:00:01:45`, or a joined combination;
   - ISO `captured_at` and the exact normalized `content` used for synthesis;
   - `privacy.classification: customer-sensitive` and `privacy.pii_review: pending` by default for customer evidence;
   - `transformation: {"stage":"normalized","parents":[],"method":"pm:ingest"}`;
   - `artifact_path` for the research topic this item will support, when already known;
   - optional private-only `local_source_path` and `raw_locator` (these are written only to `.pm/`).
4. Register it through deterministic code:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/evidence.js" register \
  --pm-dir "{pm_dir}" --private-dir "{pm_state_dir}" \
  --request "{pm_state_dir}/evidence/requests/{request}.json" --json
```

Capture the returned `evidence_id` on the normalized item. Re-registering identical source identity and content is `unchanged`; changed content keeps the ID and appends the prior hash to `revisions`.

### Legacy v1 records

Do not eagerly rewrite `.pm/imports/manifest.json` or all old records. When an existing v1 normalized record is touched, migrate that record incrementally:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/evidence.js" migrate \
  --pm-dir "{pm_dir}" --private-dir "{pm_state_dir}" \
  --request "{pm_state_dir}/evidence/source-0001.json" --json
```

The migration keeps the original record and manifest readable, writes a private v2 record, and publishes no machine-local path.

### Quality and ambiguity

Do not invent optional structure. Leave unclear optional values absent. If `topic`, `pain_point`, or `summary` cannot be extracted reliably, skip the item and report a parse warning. Confirm ambiguous CSV mappings before registration because a deterministic ID cannot make a semantically wrong mapping correct.

For audio evidence, read and follow `${CLAUDE_PLUGIN_ROOT}/skills/ingest/references/audio-pipeline.md`; use timestamp locators and prefer customer speech over interviewer prompts.

### Replacement behavior

- **Unchanged file and records:** skip or accept `unchanged`; do not duplicate.
- **Changed file at the same path:** register changed normalized records, retain prior revisions, and re-synthesize only affected artifacts.
- **Deleted or moved file:** report it; never delete ledger records or revisions automatically.
- **Ambiguous incremental state:** offer a full rebuild; never guess which evidence to discard.

### Privacy gate

Do not promise perfect redaction. Redact obvious names/account identifiers when safe, keep quotes short, and tell the user:

> Review these findings before committing. Automatic PII detection is not reliable enough to guarantee safe redaction.

A `pending` record may be normalized privately, but reader artifacts containing customer material still require that explicit warning before commit.

## Done-when

Every accepted item has a stable Evidence-ID, private mode-0600 normalized record, portable ledger entry, explicit privacy/PII state, and manifest dedup state; unchanged imports are idempotent, changed imports preserve revisions, and unreliable items remain warnings.

**Advance:** proceed to Step 3 (Synthesize).
