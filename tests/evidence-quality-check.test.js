"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { scoreEvidenceArtifact } = require("../scripts/evidence-quality-check");

function score(name) {
  const dir = path.resolve(__dirname, `../evals/evidence-quality/${name}`);
  return scoreEvidenceArtifact({
    markdown: fs.readFileSync(path.join(dir, "artifact.md"), "utf8"),
    ledger: JSON.parse(fs.readFileSync(path.join(dir, "ledger.json"), "utf8")),
    artifactPath: "evidence/research/bulk-editing.md",
  });
}

test("strong evidence fixture is traceable, uncertainty-aware, and decision-useful", () => {
  const result = score("strong");
  assert.deepEqual(result.citation_issues, []);
  assert.equal(result.score, 10);
  assert.deepEqual(result.dimensions, {
    traceability: 2,
    source_coverage: 2,
    uncertainty: 2,
    contradiction: 2,
    decision_usefulness: 2,
  });
});

test("schema-valid but superficial evidence fixture scores materially lower", () => {
  const result = score("weak");
  assert.deepEqual(result.citation_issues, []);
  assert.ok(result.score <= 4, `expected weak score <= 4, got ${result.score}`);
  assert.ok(score("strong").score - result.score >= 6);
});
