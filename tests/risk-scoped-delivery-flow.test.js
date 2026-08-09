"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { selectPublicationRoute } = require("../scripts/review-convergence");

test("declared exact policy selects review-first and one final certification", () => {
  const result = selectPublicationRoute({
    candidateRoute: true,
    protectedPermission: true,
    exactAdapterCoverage: true,
  });
  assert.equal(result.route, "review-candidate");
  assert.equal(result.publish_draft, true);
  assert.equal(result.enter_finalization, true);
});

test("CleanLog current contract chooses comprehensive before draft with no duplicate certification", () => {
  const result = selectPublicationRoute({
    candidateRoute: true,
    protectedPermission: false,
    exactAdapterCoverage: true,
  });
  assert.equal(result.route, "comprehensive");
  assert.equal(result.publish_draft, false);
});

test("missing exact adapter coverage falls back before draft", () => {
  const result = selectPublicationRoute({
    candidateRoute: true,
    protectedPermission: true,
    exactAdapterCoverage: false,
  });
  assert.equal(result.route, "comprehensive");
  assert.equal(result.publish_draft, false);
});
