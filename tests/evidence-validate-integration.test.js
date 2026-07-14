"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  createEvidenceRecord,
  emptyEvidenceLedger,
  registerEvidence,
} = require("../scripts/lib/evidence-schema");
const { validate } = require("../scripts/validate");

const NOW = "2026-07-14T08:00:00.000Z";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-evidence-validation-"));
  const pmDir = path.join(root, "pm");
  fs.mkdirSync(path.join(pmDir, "evidence", "research"), { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return pmDir;
}

function record(artifactPath = "evidence/research/pricing.md") {
  return createEvidenceRecord(
    {
      source_type: "web",
      source_label: "example.com/pricing",
      source_format: "html",
      locator: "pricing-table",
      captured_at: NOW,
      content: "Starter costs $20.",
      privacy: { classification: "public", pii_review: "not-required" },
      transformation: { stage: "captured", parents: [], method: "pm:research" },
      artifact_path: artifactPath,
    },
    { now: NOW }
  );
}

function writeV2(pmDir, evidenceId, options = {}) {
  const citation = options.omitCitation ? "" : ` [evidence:${evidenceId}]`;
  const markdown = [
    "---",
    "type: evidence",
    "evidence_type: research",
    "source_origin: external",
    "created: 2026-07-14",
    "sources:",
    '  - "https://example.com/pricing"',
    "cited_by: []",
    "provenance_version: 2",
    "---",
    "",
    "# Pricing",
    "",
    "## Findings",
    "",
    `- Starter costs $20.${citation}`,
    "",
  ].join("\n");
  fs.writeFileSync(path.join(pmDir, "evidence", "research", "pricing.md"), markdown);
}

test("standard PM validation accepts a bound Evidence v2 artifact", (t) => {
  const pmDir = fixture(t);
  const item = record();
  const ledger = registerEvidence(emptyEvidenceLedger(NOW), item, { now: NOW }).ledger;
  fs.writeFileSync(
    path.join(pmDir, "evidence", "provenance.json"),
    `${JSON.stringify(ledger, null, 2)}\n`
  );
  writeV2(pmDir, item.evidence_id);

  const result = validate(pmDir);
  assert.deepEqual(result.errors, []);
});

test("standard PM validation rejects malformed ledgers and v2 artifacts without a ledger", (t) => {
  const malformedDir = fixture(t);
  fs.writeFileSync(path.join(malformedDir, "evidence", "provenance.json"), "{not json\n");
  writeV2(malformedDir, "ev_ffffffffffffffffffffffff");
  assert.match(
    validate(malformedDir)
      .errors.map((issue) => issue.msg)
      .join("\n"),
    /invalid JSON/i
  );

  const missingDir = fixture(t);
  writeV2(missingDir, "ev_ffffffffffffffffffffffff");
  assert.match(
    validate(missingDir)
      .errors.map((issue) => issue.msg)
      .join("\n"),
    /requires evidence\/provenance\.json/i
  );
});

test("standard PM validation rejects missing and cross-artifact citations", (t) => {
  const pmDir = fixture(t);
  const item = record("evidence/research/another.md");
  const ledger = registerEvidence(emptyEvidenceLedger(NOW), item, { now: NOW }).ledger;
  fs.writeFileSync(
    path.join(pmDir, "evidence", "provenance.json"),
    `${JSON.stringify(ledger, null, 2)}\n`
  );
  writeV2(pmDir, item.evidence_id);
  assert.match(
    validate(pmDir)
      .errors.map((issue) => issue.msg)
      .join("\n"),
    /not bound to artifact/i
  );

  writeV2(pmDir, item.evidence_id, { omitCitation: true });
  assert.match(
    validate(pmDir)
      .errors.map((issue) => issue.msg)
      .join("\n"),
    /finding is missing an evidence citation/i
  );
});
