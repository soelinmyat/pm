"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  auditEvidence,
  createEvidenceRecord,
  deriveEvidenceId,
  emptyEvidenceLedger,
  migrateLegacyEvidenceRecord,
  refreshEvidence,
  registerEvidence,
  validateCitationBindings,
  validateEvidenceLedger,
} = require("../scripts/lib/evidence-schema");

const NOW = "2026-07-14T08:00:00.000Z";

function input(overrides = {}) {
  return {
    source_type: "support",
    source_label: "support-export.csv",
    source_format: "csv",
    locator: "row:14",
    captured_at: "2026-07-10T04:00:00.000Z",
    content: "Batch editing 50 records one-by-one is painful.",
    privacy: {
      classification: "customer-sensitive",
      pii_review: "reviewed",
    },
    transformation: {
      stage: "normalized",
      parents: [],
      method: "pm:ingest",
    },
    artifact_path: "evidence/research/bulk-editing.md",
    ...overrides,
  };
}

test("evidence identity is provider-neutral and independent of mutable content", () => {
  const identity = {
    source_type: "support",
    source_label: " Support-Export.csv ",
    locator: " ROW:14 ",
  };
  const first = deriveEvidenceId(identity);
  const second = deriveEvidenceId({
    ...identity,
    source_label: "support-export.csv",
    locator: "row:14",
  });
  assert.match(first, /^ev_[a-f0-9]{24}$/);
  assert.equal(first, second);
  assert.equal(createEvidenceRecord(input(), { now: NOW }).evidence_id, first);
  assert.equal(
    createEvidenceRecord(input({ content: "Changed content" }), { now: NOW }).evidence_id,
    first
  );
});

test("register is idempotent and content changes append revision history", () => {
  let ledger = emptyEvidenceLedger(NOW);
  const first = createEvidenceRecord(input(), { now: NOW });
  let result = registerEvidence(ledger, first, { now: NOW });
  assert.equal(result.decision, "created");
  ledger = result.ledger;

  result = registerEvidence(ledger, first, { now: NOW });
  assert.equal(result.decision, "unchanged");
  assert.equal(result.ledger.records[0].revisions.length, 0);

  const changed = createEvidenceRecord(input({ content: "Updated normalized content." }), {
    now: "2026-07-15T08:00:00.000Z",
  });
  result = registerEvidence(ledger, changed, { now: "2026-07-15T08:00:00.000Z" });
  assert.equal(result.decision, "revised");
  assert.equal(result.ledger.records[0].evidence_id, first.evidence_id);
  assert.equal(result.ledger.records[0].revisions.length, 1);
  assert.equal(result.ledger.records[0].revisions[0].content_sha256, first.content_sha256);
});

test("one evidence identity can bind to multiple artifacts without duplication", () => {
  const first = createEvidenceRecord(input(), { now: NOW });
  let result = registerEvidence(emptyEvidenceLedger(NOW), first, { now: NOW });
  const second = createEvidenceRecord(input({ artifact_path: "evidence/research/pricing.md" }), {
    now: NOW,
  });
  result = registerEvidence(result.ledger, second, { now: "2026-07-14T09:00:00.000Z" });
  assert.equal(result.decision, "bound");
  assert.equal(result.ledger.records.length, 1);
  assert.deepEqual(result.ledger.records[0].artifact_paths, [
    "evidence/research/bulk-editing.md",
    "evidence/research/pricing.md",
  ]);
});

test("refresh is compare-and-swap and never drops prior revisions", () => {
  const record = createEvidenceRecord(input(), { now: NOW });
  const registered = registerEvidence(emptyEvidenceLedger(NOW), record, { now: NOW }).ledger;
  assert.throws(
    () =>
      refreshEvidence(
        registered,
        {
          evidence_id: record.evidence_id,
          observed_content_sha256: `sha256:${"f".repeat(64)}`,
          content: "Fresh content",
          captured_at: "2026-07-16T08:00:00.000Z",
        },
        { now: "2026-07-16T08:00:00.000Z" }
      ),
    (error) => error.code === "EVIDENCE_CONFLICT" && /observed content hash/i.test(error.message)
  );

  const refreshed = refreshEvidence(
    registered,
    {
      evidence_id: record.evidence_id,
      observed_content_sha256: record.content_sha256,
      content: "Fresh content",
      captured_at: "2026-07-16T08:00:00.000Z",
    },
    { now: "2026-07-16T08:00:00.000Z" }
  );
  assert.equal(refreshed.decision, "refreshed");
  assert.equal(refreshed.ledger.records[0].revisions.length, 1);
  assert.equal(refreshed.ledger.records[0].revisions[0].content_sha256, record.content_sha256);
});

test("ledger validation rejects private paths, invalid privacy, dangling parents, and identity drift", () => {
  const parent = createEvidenceRecord(input(), { now: NOW });
  const child = createEvidenceRecord(
    input({
      source_type: "research",
      source_label: "bulk-editing synthesis",
      locator: "finding:1",
      privacy: { classification: "public", pii_review: "not-required" },
      transformation: {
        stage: "synthesized",
        parents: [parent.evidence_id],
        method: "pm:research",
      },
    }),
    { now: NOW }
  );
  let ledger = registerEvidence(emptyEvidenceLedger(NOW), parent, { now: NOW }).ledger;
  ledger = registerEvidence(ledger, child, { now: NOW }).ledger;
  assert.deepEqual(validateEvidenceLedger(ledger), []);

  const unsafe = structuredClone(ledger);
  unsafe.records[0].source_label = "/Users/alice/private/support.csv";
  unsafe.records[0].locator = "/Users/alice/private/support.csv:14";
  unsafe.records[0].privacy.pii_review = "not-required";
  unsafe.records[1].transformation.parents = ["ev_ffffffffffffffffffffffff"];
  const issues = validateEvidenceLedger(unsafe).join("\n");
  assert.match(issues, /portable/i);
  assert.match(issues, /locator/i);
  assert.match(issues, /PII review/i);
  assert.match(issues, /parent/i);
  assert.match(issues, /derived identity/i);
});

test("citation validation binds every v2 finding to this artifact and a current ledger record", () => {
  const record = createEvidenceRecord(input(), { now: NOW });
  const ledger = registerEvidence(emptyEvidenceLedger(NOW), record, { now: NOW }).ledger;
  const valid = `---\ntype: research\nprovenance_version: 2\n---\n\n## Findings\n\n- Batch editing is painful. [evidence:${record.evidence_id}]\n`;
  assert.deepEqual(
    validateCitationBindings({
      markdown: valid,
      ledger,
      artifactPath: "evidence/research/bulk-editing.md",
    }),
    []
  );

  const missing = valid.replace(record.evidence_id, "ev_ffffffffffffffffffffffff");
  assert.match(
    validateCitationBindings({
      markdown: missing,
      ledger,
      artifactPath: "evidence/research/bulk-editing.md",
    }).join("\n"),
    /unknown evidence ID/i
  );
  assert.match(
    validateCitationBindings({
      markdown: valid.replace(` [evidence:${record.evidence_id}]`, ""),
      ledger,
      artifactPath: "evidence/research/bulk-editing.md",
    }).join("\n"),
    /finding.*citation/i
  );
});

test("citation validation binds every v2 note entry Evidence-ID", () => {
  const noteRecord = createEvidenceRecord(
    input({
      source_type: "note",
      source_label: "notes/2026-07.md",
      source_format: "md",
      locator: "entry:2026-07-14T08:00:00.000Z:test",
      privacy: { classification: "internal", pii_review: "not-required" },
      transformation: { stage: "captured", parents: [], method: "pm:note" },
      artifact_path: "evidence/notes/2026-07.md",
    }),
    { now: NOW }
  );
  const ledger = registerEvidence(emptyEvidenceLedger(NOW), noteRecord, { now: NOW }).ledger;
  const valid = `---\ntype: notes\nprovenance_version: 2\n---\n\n### 2026-07-14 16:00 — observation\nSignal\nEvidence-ID: ${noteRecord.evidence_id}\n`;
  assert.deepEqual(
    validateCitationBindings({
      markdown: valid,
      ledger,
      artifactPath: "evidence/notes/2026-07.md",
    }),
    []
  );
  assert.match(
    validateCitationBindings({
      markdown: valid.replace(/^Evidence-ID:.*$/m, ""),
      ledger,
      artifactPath: "evidence/notes/2026-07.md",
    }).join("\n"),
    /note entry is missing an Evidence-ID/i
  );
});

test("staleness audit reports observed timestamp, threshold, age, and state", () => {
  const record = createEvidenceRecord(
    input({ source_type: "web", captured_at: "2026-03-01T00:00:00.000Z" }),
    { now: NOW }
  );
  const ledger = registerEvidence(emptyEvidenceLedger(NOW), record, { now: NOW }).ledger;
  const audit = auditEvidence(ledger, { now: "2026-07-14T00:00:00.000Z" });
  assert.deepEqual(audit.records[0], {
    evidence_id: record.evidence_id,
    observed_at: "2026-03-01T00:00:00.000Z",
    threshold_days: 90,
    age_days: 135,
    state: "stale",
  });
});

test("legacy ingest records migrate incrementally without publishing local paths", () => {
  const migrated = migrateLegacyEvidenceRecord({
    id: "legacy-14",
    source_path: "/Users/alice/Downloads/support-export.csv",
    source_type: "support",
    source_format: "csv",
    imported_at: "2026-07-14T08:00:00Z",
    topic: "bulk editing",
    pain_point: "editing many rows is slow",
    summary: "Customer requested batch edits.",
    quote: "Editing 50 rows one by one is painful.",
    raw_ref: { file: "/Users/alice/Downloads/support-export.csv", row: 14 },
  });
  const portable = createEvidenceRecord(migrated.request, { now: NOW });
  assert.equal(portable.source_label, "support-export.csv");
  assert.equal(portable.locator, "row:14");
  assert.equal(portable.privacy.pii_review, "pending");
  assert.doesNotMatch(JSON.stringify(portable), /\/Users\/alice/);
  assert.match(JSON.stringify(migrated.private_record), /\/Users\/alice/);
});
