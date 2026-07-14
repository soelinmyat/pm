"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { validateProposal } = require("../scripts/lib/proposal-schema");
const { scoreProposal } = require("../scripts/proposal-quality-check");

const fixtureRoot = path.join(__dirname, "fixtures", "proposals");

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(fixtureRoot, name), "utf8"));
}

test("blind calibration separates strong and weak proposals after both pass schema validation", () => {
  const candidates = [fixture("strong-v1.json"), fixture("weak-schema-valid-v1.json")]
    .map((proposal) => ({ proposal, validation: validateProposal(proposal) }))
    .sort((left, right) => left.proposal.id.localeCompare(right.proposal.id));
  for (const candidate of candidates)
    assert.equal(candidate.validation.ok, true, JSON.stringify(candidate.validation.issues));

  const scores = Object.fromEntries(
    candidates.map(({ proposal }) => [proposal.slug, scoreProposal(proposal)])
  );
  assert.equal(scores["structured-groom"].quality_passed, true);
  assert.equal(scores["generic-groom"].quality_passed, false);
  assert.ok(
    scores["structured-groom"].score - scores["generic-groom"].score >= 30,
    JSON.stringify(scores, null, 2)
  );
});

test("quality score is bounded, dimensioned, and does not replace schema eligibility", () => {
  const result = scoreProposal(fixture("strong-v1.json"));
  assert.equal(result.maximum, 100);
  assert.equal(
    Object.values(result.dimensions).reduce((sum, score) => sum + score, 0),
    result.score
  );
  assert.deepEqual(Object.keys(result.dimensions), [
    "evidence",
    "scope",
    "acceptance",
    "decisions",
    "experience",
    "traceability",
  ]);
});
