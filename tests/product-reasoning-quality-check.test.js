"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
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

test("schema-valid padded reasoning cannot clear the quality gate", () => {
  const padded = fixture("strong");
  padded.problem = "problem ".repeat(12).trim();
  padded.evidence_refs.forEach((entry, index) => {
    entry.note = `${String.fromCharCode(97 + index)} `.repeat(30).trim();
  });
  padded.alternatives.forEach((entry, index) => {
    entry.tradeoff = `${String.fromCharCode(100 + index)} `.repeat(30).trim();
  });
  padded.decision.rationale = "guided ".repeat(12).trim();
  padded.confidence.basis = ["basis ".repeat(8).trim(), "reason ".repeat(8).trim()];
  padded.non_goals = ["exclude ".repeat(6).trim(), "avoid ".repeat(6).trim()];
  padded.next_trigger.condition = "trigger ".repeat(8).trim();
  const result = scoreDecisionBrief(padded);
  assert.equal(result.valid, true);
  assert.equal(result.passed, false);
  assert.ok(result.score < 7, JSON.stringify(result));
});

test("schema-valid padded feature prose cannot clear the quality gate", () => {
  const padded = inventoryFixture("strong");
  padded.areas
    .flatMap((area) => area.features)
    .forEach((feature, index) => {
      feature.outcome = `outcome${index} `.repeat(10).trim();
      feature.highlights = [
        `highlight${index} `.repeat(5).trim(),
        `detail${index} `.repeat(5).trim(),
      ];
    });
  const result = scoreFeatureInventory(padded);
  assert.equal(result.valid, true);
  assert.equal(result.passed, false);
  assert.ok(result.score < 7, JSON.stringify(result));
});

test("superficially varied repeated phrases cannot clear either quality gate", () => {
  const phrase = (prefix) => `${prefix} alpha beta gamma delta epsilon `.repeat(2).trim();
  const decision = fixture("strong");
  decision.problem = phrase("problem");
  decision.evidence_refs.forEach((entry, index) => (entry.note = phrase(`evidence${index}`)));
  decision.alternatives.forEach((entry, index) => (entry.tradeoff = phrase(`tradeoff${index}`)));
  decision.decision.rationale = phrase("guided");
  decision.confidence.basis = [phrase("basis-one"), phrase("basis-two")];
  decision.non_goals = [phrase("exclude-one"), phrase("exclude-two")];
  decision.next_trigger.condition = phrase("trigger");
  const decisionResult = scoreDecisionBrief(decision);
  assert.equal(decisionResult.valid, true);
  assert.ok(decisionResult.score < 7, JSON.stringify(decisionResult));

  const inventory = inventoryFixture("strong");
  inventory.areas
    .flatMap((area) => area.features)
    .forEach((feature, index) => {
      feature.outcome = phrase(`outcome${index}`);
      feature.highlights = [phrase(`highlight${index}-a`), phrase(`highlight${index}-b`)];
    });
  const inventoryResult = scoreFeatureInventory(inventory);
  assert.equal(inventoryResult.valid, true);
  assert.ok(inventoryResult.score < 7, JSON.stringify(inventoryResult));
});

test("decision rationale must name a token specific to the chosen alternative", () => {
  const decision = fixture("strong");
  decision.decision.rationale =
    "Refresh keeps source selection and conflict decisions under careful human control.";
  const result = scoreDecisionBrief(decision);
  assert.equal(result.valid, true);
  assert.equal(result.checks.confirmed_decision, false);
});

test("quality CLI returns structured schema diagnostics for every malformed JSON root", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-reasoning-quality-total-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cli = path.join(__dirname, "..", "scripts", "product-reasoning-quality-check.js");
  for (const [name, value] of [
    ["null", null],
    ["number", 1],
    ["string", "invalid"],
    ["array", []],
  ]) {
    const input = path.join(root, `${name}.json`);
    fs.writeFileSync(input, JSON.stringify(value));
    const result = spawnSync(process.execPath, [cli, input], { encoding: "utf8" });
    assert.equal(result.status, 2, `${name}: ${result.stderr}`);
    assert.equal(result.stderr, "");
    const output = JSON.parse(result.stdout);
    assert.equal(output.valid, false);
    assert.match(output.issues.join("\n"), /must be an object/);
  }
});
