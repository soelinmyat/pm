"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { selectDeliveryRoute } = require("../scripts/delivery-attestation");

test("declared exact policy selects review-first and one final certification", () => {
  const result = selectDeliveryRoute({
    candidate_policy: { authenticated: true, permitted: true },
    adapter: { supported: true, exact_coverage: true },
    evidence_equivalence: true,
    latest_base_capability: { authenticated: true, available: true },
  });
  assert.equal(result.route, "optimized");
  assert.equal(result.publish_draft_before_complete, true);
  assert.equal(result.complete_certification_limit, 1);
});

test("CleanLog current contract chooses comprehensive before draft with no duplicate certification", () => {
  const result = selectDeliveryRoute({
    candidate_policy: null,
    adapter: { supported: true, exact_coverage: true },
    evidence_equivalence: true,
  });
  assert.equal(result.route, "comprehensive");
  assert.equal(result.publish_draft_before_complete, false);
  assert.equal(result.complete_certification_limit, 1);
  assert.match(result.reason, /candidate-push policy/i);
  assert.deepEqual(result.consumer_writes, []);
});

test("missing latest-base capability falls back before draft even with candidate permission", () => {
  const result = selectDeliveryRoute({
    candidate_policy: { authenticated: true, permitted: true },
    adapter: { supported: true, exact_coverage: true },
    evidence_equivalence: true,
  });
  assert.equal(result.route, "comprehensive");
  assert.equal(result.publish_draft_before_complete, false);
  assert.match(result.reason, /latest-base/i);
});
