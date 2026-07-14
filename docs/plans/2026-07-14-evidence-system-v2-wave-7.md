---
title: "Evidence system v2 — Wave 7"
created: 2026-07-14
updated: 2026-07-14
status: certification
owners:
  - pm-plugin
---

# Evidence system v2 — Wave 7

## Outcome

Make `pm:note`, `pm:ingest`, `pm:research`, and `pm:refresh` one provenance-compatible family without turning research into a generic workflow engine. Deterministic code owns evidence identity, hashes, privacy labels, transformations, revisions, staleness, conflict detection, and atomic publication. Each skill continues to own its model judgment: capture phrasing, normalization, synthesis, source evaluation, contradiction handling, and refresh scope.

The human research surface remains Markdown. HTML is reserved for a future substantial comparative report whose navigation or visual structure materially benefits from it.

## Baseline findings

1. The four skills describe overlapping evidence fields with different names and no shared executable schema.
2. Ingest keeps raw provenance privately, but research and refresh cannot deterministically connect claims back to those private records.
3. Research requires URLs and access dates in prose, while refresh infers staleness from several document-specific date fields. Neither has one machine-readable freshness result.
4. Refresh promises preservation, but there is no compare-and-swap contract that prevents a stale refresh process from overwriting a newer artifact.
5. Note promises an atomic append, but `writeNote` currently performs a read-modify-`writeFileSync` sequence without a lock or atomic replacement.
6. Existing evidence and notes must remain readable. Wave 7 cannot require consumers to rewrite their knowledge bases before the next capture or refresh.

## Architecture

### Shared evidence identity

Add a provider-neutral evidence record contract with:

- `evidence_id`: stable `ev_` identity derived from canonical source identity and locator, not mutable content;
- `source_type`, portable `source_label`, source format, and capture/observation time;
- `content_sha256`: exact normalized content hash;
- privacy classification and explicit PII review state;
- transformation stage (`captured`, `normalized`, `synthesized`) and parent evidence IDs;
- append-only artifact-path bindings when committed evidence exists;
- append-only content revisions, including superseded hashes rather than deletion.

Machine-local paths and raw locators stay under `.pm/evidence/`. The committed `{pm_dir}/evidence/provenance.json` ledger contains portable labels/locators, hashes, classifications, transformations, append-only artifact-path bindings, and revision history only.

### Deterministic evidence CLI

Add one focused CLI and shared library for:

1. `register` — validate a request, derive or verify identity, merge without losing revisions, and atomically publish the ledger;
2. `refresh` — require the caller's observed artifact/content hash, reject stale writers, append the old revision, and preserve prior evidence;
3. `validate` — validate ledger schema, identity derivation, hashes, parent references, paths, privacy rules, and citation bindings;
4. `audit` — return deterministic freshness results using the canonical source/type thresholds.

This is an evidence boundary, not a general workflow runner. It does not choose research mode, decide source quality, synthesize findings, or route product insights.

### Citation contract

New or migrated v2 research findings cite one or more ledger IDs with `[evidence:ev_<id>]`. Validation binds those IDs to ledger records and the current artifact. Existing legacy research remains readable and gets upgraded when touched; validation does not invalidate untouched v1 knowledge bases.

### Skill integration

- `pm:note` obtains a stable evidence ID, writes it into the monthly entry, and publishes the note plus ledger update under one lock with atomic replacements.
- `pm:ingest` creates private normalized records through the schema library and registers portable committed provenance during synthesis.
- `pm:research` registers every durable source, cites evidence IDs in findings, distinguishes facts/hypotheses/contradictions, and validates before routing.
- `pm:refresh` starts from an audit snapshot and performs compare-and-swap refreshes; conflicts preserve both the current artifact and the proposed update for explicit reconciliation.

## Compatibility and migration

- Parse existing note entries that have no `Evidence-ID` and assign IDs only when they are touched or digested.
- Accept the current private ingest manifest as version 1; provide deterministic upgrade to the v2 record shape without moving raw inputs.
- Treat research documents without the v2 provenance marker as legacy. Research or Refresh upgrades a touched document and its relevant sources; broad eager migration is not required.
- Never place an absolute path, raw customer content, account name, or unrestricted quote in the committed ledger.
- Preserve unknown user-authored Markdown sections and existing frontmatter keys during refresh.

## Work units

### W7.1 — Evidence schema and ledger

Implement identity derivation, schema validation, safe path rules, privacy rules, parent/revision validation, atomic ledger merge, and compatibility parsing.

### W7.2 — Register, refresh, validate, and audit CLI

Implement request-file-based commands, compare-and-swap refresh, citation validation, staleness projection, machine-readable results, and failure contracts.

### W7.3 — Note and Ingest integration

Make note capture actually atomic and evidence-bound. Replace ad hoc ingest normalization/manifest instructions with the executable record contract while retaining raw/private boundaries and PII warnings.

### W7.4 — Research and Refresh integration

Update research templates and steps to publish ledger-backed citations. Update refresh to consume audit snapshots and reject stale writers without deleting prior evidence.

### W7.5 — Quality, migration, and release certification

Add strong/weak fixtures, malformed/stale/conflict/privacy cases, legacy migration coverage, installed-cache smoke tests, current-commit review, and workhorse-model canaries where available.

## Acceptance criteria

1. The same source identity and locator produce the same evidence ID across runs and providers; content changes create revisions without changing identity.
2. A committed ledger never contains absolute local paths or raw restricted/customer-sensitive content.
3. Raw imports and private normalized records remain under `.pm/`; portable ledger records and reader artifacts live under `{pm_dir}/evidence/`.
4. Note capture uses a lock plus atomic publication and cannot silently lose an existing entry during a competing append.
5. Re-importing unchanged evidence is idempotent; a changed source appends revision history and re-synthesizes only affected artifacts.
6. Every v2 research finding cites a valid evidence ID; missing, malformed, or cross-artifact citations fail validation.
7. Staleness is computed from one canonical table and reports the exact observed timestamp, threshold, age, and freshness state.
8. Refresh requires the hash it observed. If the artifact or ledger changed, it fails closed and preserves the proposed update for reconciliation.
9. Refresh never silently removes a record, revision, citation, contradiction, or user-authored Markdown section.
10. Legacy notes, ingest manifests, and research documents remain readable and can be upgraded incrementally.
11. Skill instructions, command descriptions, public docs, artifact matrix, and tests describe the same evidence lifecycle.
12. Focused tests, full quality, plugin validation, current-commit Review, installed-cache canaries, hosted CI, merge receipt, and main-commit tag all pass.

## Evaluation matrix

Supporting-workflow depth applies:

- trigger and negative-trigger fixtures for all four skills;
- one representative capture/import/research/refresh success path;
- malformed record, privacy leak, stale citation, and refresh-conflict fixtures;
- strong and weak research artifacts scored for traceability, uncertainty, contradiction handling, and decision usefulness;
- a repeated-run identity/idempotency fixture;
- one Sol High end-to-end canary and one Opus xHigh canary when the runtime is available, with unavailable capability recorded rather than guessed.

## Non-goals

- A generic evidence database or workflow engine.
- Committing raw customer exports or machine-local source paths.
- Converting ordinary research Markdown into HTML.
- Requiring subagents or a fixed reviewer count.
- Eagerly rewriting every legacy knowledge-base file.
- Letting deterministic validation decide whether a source is credible or a finding is strategically important.

## Release sequence

Follow the plugin master-plan protocol: tests first, implementation, focused and full verification, patch preparation before final Review, routed quality gates, both installed caches, PR/CI/merge, then place the version tag on the `main` merge commit.

## Certification evidence

- Evidence runtime focused suite: 42 tests passing after remediation, covering identity, revisions, multi-artifact binding, legacy migration, privacy/path rejection, note-entry binding, citation validation, freshness, conflict preservation, bounded reads, and concurrent note capture.
- Full plugin suite: 1,909 tests, 1,903 passed, 6 dependency skips, 0 failures.
- Plugin authoring contract: 21 rules over 140 runtime files, 0 issues.
- Quality calibration: strong research fixture 10/10; schema-valid superficial fixture 4/10.
- Formatting and lint: Prettier clean; ESLint has no errors (14 pre-existing warnings outside Wave 7 files).
- Remaining release gates: patch preparation, frozen-target Review, cache smoke tests, hosted CI, merge receipt, and main-commit tag.
