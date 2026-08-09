"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyBaseDrift } = require("../scripts/base-drift");
const { receiptAuthentication } = require("../scripts/lib/repository-capabilities");

const KEY = Buffer.alloc(32, 9);
const EXPECTED = {
  repository: "acme/repo",
  base_commit: "a".repeat(40),
  head_commit: "b".repeat(40),
  result_commit: "c".repeat(40),
};
function receipt(clean = true) {
  const value = {
    schema_version: 1,
    kind: "github-merge-result-v1",
    identity: "merge-result-v1",
    ...EXPECTED,
    clean,
    observed_at: "2026-08-10T00:00:00.000Z",
  };
  return { ...value, authentication: receiptAuthentication(value, KEY) };
}
const OPTIONS = { key: KEY, now: new Date("2026-08-10T00:01:00.000Z") };

test("base drift classifies disjoint, overlapping, conflicting, and indeterminate", () => {
  assert.equal(
    classifyBaseDrift({ feature_paths: ["app/a.js"], base_paths: ["docs/b.md"] }).classification,
    "disjoint"
  );
  assert.equal(
    classifyBaseDrift(
      {
        feature_paths: ["app/a.js"],
        base_paths: ["app/a.js"],
        merge_result: receipt(true),
        merge_expectation: EXPECTED,
      },
      OPTIONS
    ).classification,
    "overlapping"
  );
  assert.equal(
    classifyBaseDrift(
      {
        feature_paths: ["app/a.js"],
        base_paths: ["app/a.js"],
        merge_result: receipt(false),
        merge_expectation: EXPECTED,
      },
      OPTIONS
    ).classification,
    "conflicting"
  );
  assert.equal(
    classifyBaseDrift({ feature_paths: ["app/a.js"], base_paths: null }).classification,
    "indeterminate"
  );
});

test("review survives disjoint drift but latest-base readiness needs authenticated capability", () => {
  const ordinary = classifyBaseDrift({ feature_paths: ["app/a.js"], base_paths: ["docs/b.md"] });
  assert.equal(ordinary.review_survives, true);
  assert.equal(ordinary.optimized_merge_ready, false);
  assert.match(ordinary.reason, /authenticated merge/i);
  const capable = classifyBaseDrift(
    {
      feature_paths: ["app/a.js"],
      base_paths: ["docs/b.md"],
      merge_result: receipt(true),
      merge_expectation: EXPECTED,
    },
    OPTIONS
  );
  assert.equal(capable.optimized_merge_ready, true);
});

test("forged or stale merge capability cannot authorize optimized readiness", () => {
  const forged = { ...receipt(true), identity: "forged" };
  assert.equal(
    classifyBaseDrift(
      { feature_paths: [], base_paths: [], merge_result: forged, merge_expectation: EXPECTED },
      OPTIONS
    ).optimized_merge_ready,
    false
  );
  assert.equal(
    classifyBaseDrift(
      {
        feature_paths: [],
        base_paths: [],
        merge_result: receipt(true),
        merge_expectation: EXPECTED,
      },
      { ...OPTIONS, now: new Date("2026-08-10T01:00:00Z") }
    ).optimized_merge_ready,
    false
  );
});
