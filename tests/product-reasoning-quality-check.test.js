"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  scoreDecisionBrief,
  scoreFeatureInventory,
} = require("../scripts/product-reasoning-quality-check");

const fixture = (quality) =>
  JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "..", "evals", "product-reasoning-quality", quality, "decision.json"),
      "utf8"
    )
  );

const inventoryFixture = (quality) =>
  JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "..", "evals", "product-reasoning-quality", quality, "features.json"),
      "utf8"
    )
  );

test("strong reasoning artifact is traceable, comparative, and action-ready", () => {
  const result = scoreDecisionBrief(fixture("strong"));
  assert.equal(result.valid, true);
  assert.equal(result.passed, true);
  assert.equal(result.score, 10);
});

test("schema-valid superficial reasoning scores materially lower", () => {
  const result = scoreDecisionBrief(fixture("weak"));
  assert.equal(result.valid, true);
  assert.equal(result.passed, false);
  assert.ok(result.score <= 4, JSON.stringify(result));
});

test("strong feature inventory is traceable and decision-useful", () => {
  const result = scoreFeatureInventory(inventoryFixture("strong"));
  assert.equal(result.valid, true);
  assert.equal(result.passed, true);
  assert.equal(result.score, 10);
});

test("schema-valid code-map inventory scores materially lower", () => {
  const result = scoreFeatureInventory(inventoryFixture("weak"));
  assert.equal(result.valid, true);
  assert.equal(result.passed, false);
  assert.ok(result.score <= 4, JSON.stringify(result));
});
