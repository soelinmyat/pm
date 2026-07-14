"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("the four evidence skills share one executable provenance contract", () => {
  for (const skill of ["note", "ingest", "research", "refresh"]) {
    const content = read(`skills/${skill}/SKILL.md`);
    assert.match(content, /references\/evidence-system\.md/, `${skill} must load Evidence v2`);
  }

  const reference = read("references/evidence-system.md");
  for (const command of ["register", "migrate", "refresh", "validate", "audit"]) {
    if (command === "migrate") continue;
    assert.match(reference, new RegExp(`evidence\\.js"? ${command}`));
  }
});

test("ingest publishes private records and claim-level v2 citations", () => {
  const normalize = read("skills/ingest/steps/02-normalize.md");
  assert.match(normalize, /(?:\.pm|\{pm_state_dir\})\/evidence\/records/);
  assert.match(normalize, /mode-0600/);
  assert.match(normalize, /evidence\.js" migrate/);
  assert.match(normalize, /customer-sensitive/);
  assert.match(normalize, /pii_review/);

  const synthesize = read("skills/ingest/steps/03-synthesize.md");
  assert.match(synthesize, /provenance_version: 2/);
  assert.match(synthesize, /\[evidence:ev_/);
  assert.match(synthesize, /Hypothesis:/);
  assert.match(synthesize, /Contradiction|contradictory/);
  assert.match(synthesize, /evidence\.js validate/);
});

test("research registers sources, preserves uncertainty, and validates bindings", () => {
  const topic = read("skills/research/steps/05-topic.md");
  assert.match(topic, /Register durable sources/);
  assert.match(topic, /artifact_path: evidence\/research/);
  assert.match(topic, /provenance_version: 2/);
  assert.match(topic, /Hypothesis:/);
  assert.match(topic, /Contradiction:/);
  assert.match(topic, /evidence\.js validate/);

  const profiling = read("skills/research/references/competitor-profiling.md");
  assert.match(profiling, /artifact_paths/);
  assert.equal((profiling.match(/^provenance_version: 2$/gm) || []).length, 5);
});

test("refresh snapshots both hashes and fails closed on conflicts", () => {
  const audit = read("skills/refresh/steps/02-audit.md");
  assert.match(audit, /evidence\.js audit/);
  assert.match(audit, /observed_artifact_sha256/);
  assert.match(audit, /Legacy — inferred freshness/);

  const execute = read("skills/refresh/steps/03-execute.md");
  assert.match(execute, /observed_content_sha256/);
  assert.match(execute, /Exit code 3/);
  assert.match(execute, /evidence\/conflicts/);
  assert.match(execute, /do not mutate `?\{pm_dir\}`?/i);
  assert.match(execute, /evidence\.js validate/);
});

test("standard PM validation is documented as the universal v2 backstop", () => {
  const validateSource = read("scripts/validate.js");
  assert.match(validateSource, /validateEvidenceV2\(pmDir, errors\)/);
  assert.match(validateSource, /v2 evidence artifact requires evidence\/provenance\.json/);

  const schema = JSON.parse(read("references/evidence-ledger.schema.json"));
  assert.equal(schema.properties.schema_version.const, 2);
  assert.ok(schema.$defs.record.required.includes("artifact_paths"));
  assert.equal(schema.$defs.record.properties.artifact_paths.uniqueItems, true);
});
