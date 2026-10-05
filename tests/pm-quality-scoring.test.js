"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  scoreDecisionBrief,
  scoreFeatureInventory,
} = require("../scripts/product-reasoning-quality-check");
const {
  validateDecisionBrief,
  validateFeatureInventory,
  featureId,
} = require("../scripts/lib/product-reasoning-schema");

function fixture(name) {
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, "../evals/product-reasoning-quality/strong", name), "utf8")
  );
}

test("reasoning structural score does not reward adoption or inflated certainty", () => {
  const decision = fixture("decision.json");
  const confirmed = scoreDecisionBrief(decision);
  assert.equal(confirmed.assessment_version, 2);
  assert.equal(confirmed.assessment_kind, "structural-readiness");
  assert.equal(confirmed.semantic_quality_verified, false);
  assert.equal(confirmed.threshold, 7);
  for (const status of ["exploring", "parked", "confirmed"]) {
    for (const level of ["low", "medium", "high"]) {
      decision.decision.status = status;
      decision.confidence = {
        level,
        basis: [
          "A current manager interview identifies repeated difficulty finding requests.",
          "No observation yet establishes how often the wider customer population encounters this problem.",
        ],
      };
      const result = scoreDecisionBrief(decision);
      assert.equal(result.valid, true, JSON.stringify(result));
      assert.equal(result.score, confirmed.score);
      assert.equal(result.confidence_calibration_verified, false);
    }
  }
});

test("declared IDs never earn a binding or quality point", () => {
  const decision = fixture("decision.json");
  const withIds = scoreDecisionBrief(decision);
  decision.evidence_refs.forEach((entry) => (entry.evidence_id = null));
  const withoutIds = scoreDecisionBrief(decision);
  assert.equal(withIds.score, withoutIds.score);
  assert.equal(withIds.evidence_binding_verified, false);
  assert.equal(withoutIds.evidence_binding_verified, false);
  assert.equal(Object.hasOwn(withIds.checks, "ledger_bound_evidence"), false);
});

test("derivative files remain one declared evidence chain, not multiple independent supports", () => {
  const decision = fixture("decision.json");
  decision.alignment.evidence_strength = "moderate";
  decision.evidence_refs.forEach((entry) => (entry.chain_id = "manager-interview-original"));
  const copies = scoreDecisionBrief(decision);
  assert.equal(copies.valid, true);
  assert.equal(copies.checks.declared_independent_chains, false);
  decision.evidence_refs.forEach(
    (entry, index) => (entry.chain_id = `independent-observation-${index}`)
  );
  const independent = scoreDecisionBrief(decision);
  assert.equal(independent.checks.declared_independent_chains, true);
  assert.equal(independent.score, copies.score + 1);
  // The declaration still needs evidence inspection; lexical checks cannot authenticate origins.
  assert.equal(independent.semantic_quality_verified, false);
});

test("a three-capability product in one meaningful area is valid without invented splits", () => {
  const inventory = fixture("features.json");
  inventory.areas = [inventory.areas[0]];
  assert.equal(inventory.areas[0].features.length, 3);
  assert.deepEqual(validateFeatureInventory(inventory), []);
  const result = scoreFeatureInventory(inventory);
  assert.equal(result.valid, true);
  assert.equal(result.passed, true);
  inventory.areas[0].features = [inventory.areas[0].features[0]];
  assert.deepEqual(validateFeatureInventory(inventory), []);
  assert.equal(scoreFeatureInventory(inventory).valid, true);
});

test("inventory confidence may be uniformly high, medium or justifiably low", () => {
  const inventory = fixture("features.json");
  const scores = [];
  for (const confidence of ["high", "medium", "low"]) {
    inventory.areas
      .flatMap((area) => area.features)
      .forEach((feature) => (feature.confidence = confidence));
    const result = scoreFeatureInventory(inventory);
    assert.equal(result.valid, true);
    assert.equal(result.confidence_calibration_verified, false);
    scores.push(result.score);
  }
  assert.deepEqual(scores, [10, 10, 10]);
});

test("a broad product does not lose distinct capabilities to a twenty-feature target", () => {
  const inventory = fixture("features.json");
  const template = inventory.areas[0].features[0];
  inventory.areas = Array.from({ length: 7 }, (_, index) => ({
    name: `User journey ${index}`,
    features: Array.from({ length: 4 }, (_, offset) => {
      const key = `capability-${index}-${offset}`;
      return { ...template, key, feature_id: featureId(inventory.source_project, key) };
    }),
  }));
  assert.equal(inventory.areas.flatMap((area) => area.features).length, 28);
  assert.deepEqual(validateFeatureInventory(inventory), []);
  inventory.areas[0].features = [];
  assert.ok(
    validateFeatureInventory(inventory).some((issue) =>
      issue.includes("features must be non-empty")
    )
  );
});

test("Evidence v2 and legacy IDs stay readable without reminting persisted identity", () => {
  for (const id of [`ev_${"a".repeat(24)}`, `ev-${"b".repeat(20)}`, null]) {
    const decision = fixture("decision.json");
    decision.evidence_refs[0].evidence_id = id;
    const before = JSON.stringify(decision);
    assert.deepEqual(validateDecisionBrief(decision), []);
    assert.equal(JSON.stringify(decision), before);
  }
  for (const id of [`ev_${"a".repeat(20)}`, `ev-${"a".repeat(24)}`, "invented-evidence", true]) {
    const decision = fixture("decision.json");
    decision.evidence_refs[0].evidence_id = id;
    assert.ok(
      validateDecisionBrief(decision).some((issue) => issue.includes("evidence_id is invalid"))
    );
  }
});
