"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (relative) => fs.readFileSync(path.join(__dirname, "..", relative), "utf8");

test("ingest retains a success without manufacturing pain or customer attribution", () => {
  const normalize = read("skills/ingest/steps/02-normalize.md");
  assert.match(normalize, /does not require a pain point/);
  assert.match(normalize, /renew because managers can audit decisions/);
  assert.doesNotMatch(normalize, /without.*pain_point.*skip/i);
  const audio = read("skills/ingest/references/audio-pipeline.md");
  assert.match(audio, /speaker roles as `unknown`, not customer endorsement/);
  assert.match(audio, /Leading questions.*do not establish customer demand/);
  assert.match(audio, /one originating observation chain, not independent corroboration/);
});

test("digest preserves unresolved observations and exact claims across routing", () => {
  const digest = read("skills/note/digest.md");
  assert.match(digest, /older signals not yet incorporated/);
  assert.match(digest, /changed enrichment regardless of timestamp/);
  assert.match(digest, /Two entries do not automatically establish a trend/);
  assert.match(digest, /selected_findings.*complete exact finding text/);
  assert.match(digest, /Save receipts only for observations actually represented/);
  assert.match(digest, /never inspect private inputs or session transcripts/);
});

test("vague bug capture preserves an unknown expected result", () => {
  const capture = read("skills/bug/steps/01-capture.md");
  assert.match(capture, /Expected behavior pending/);
  assert.doesNotMatch(capture, /behaves correctly again/);
});
