"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const generation = fs.readFileSync(
  path.join(ROOT, "skills", "rfc", "steps", "02-rfc-generation.md"),
  "utf8"
);
const contract = fs.readFileSync(
  path.join(ROOT, "skills", "rfc", "references", "generation-contract.md"),
  "utf8"
);

test("RFC generation loads canonical Test Strategy sources through phase metadata", () => {
  assert.match(generation, /\.\.\/\.\.\/dev\/test-layers\.md/);
  assert.match(generation, /rfc-template\.md/);
  assert.match(generation, /complete Test Strategy/);
  assert.match(generation, /Test hooks/);
  assert.doesNotMatch(generation, /skills\/dev\/references\/test-layers\.md/);
});

test("RFC generation uses a strict artifact result instead of a prose sentinel", () => {
  assert.match(generation, /rfc-prompt\.js/);
  assert.match(generation, /artifact identity/);
  assert.match(contract, /rfc-phase-result-v1/);
  assert.match(contract, /sidecar_hash/);
  assert.doesNotMatch(generation, /RFC_COMPLETE/);
});

test("RFC generation preserves stable HTML and sidecar contracts", () => {
  for (const hook of [
    "data-schema-version",
    "data-sidecar-hash",
    'id=\\"execution-contract\\"',
    "issue-detail",
    "test-strategy-block",
    "hooks-badge",
  ]) {
    assert.match(contract, new RegExp(hook));
  }
  assert.match(generation, /rfc-sidecar-check\.js/);
  assert.match(generation, /issue-card count/);
});

test("generation worker has no review, approval, tracker, loop, or implementation authority", () => {
  assert.match(contract, /external_effects: false/);
  assert.match(
    contract,
    /Do not include review, approval, Linear, loop, or implementation procedures/
  );
  assert.match(
    generation,
    /cannot update proposal lifecycle, approve the RFC, create tracker issues, or start implementation/
  );
});
