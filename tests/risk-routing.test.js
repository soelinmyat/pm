"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { classifyDeliveryCandidate } = require("../scripts/lib/dev-session-schema");

const ZERO_RISK = Object.freeze({
  auth: false,
  data: false,
  migration: false,
  external_contract: false,
  shared: false,
  operational: false,
  configuration: false,
  lockfile: false,
  ambiguous: false,
});

function eligibleFacts(overrides = {}) {
  return {
    size: "S",
    changed_paths: ["apps/web/src/feature.js", "apps/web/test/feature.test.js"],
    app_root: "apps/web",
    dependency_scope: "app-local",
    configuration_identity: `sha256:${"a".repeat(64)}`,
    risk: { ...ZERO_RISK },
    ...overrides,
  };
}

test("only proven XS/S app-local low-risk work selects review-candidate routing", () => {
  for (const size of ["XS", "S"]) {
    const result = classifyDeliveryCandidate(eligibleFacts({ size }));
    assert.equal(result.route, "review-candidate");
    assert.equal(result.eligible, true);
    assert.deepEqual(result.reasons, [
      `${size} change is confined to apps/web with known app-local dependencies and no listed risk`,
    ]);
  }
});

test("every listed risky fact selects comprehensive routing and names the fact", () => {
  for (const riskName of Object.keys(ZERO_RISK)) {
    const facts = eligibleFacts();
    facts.risk[riskName] = true;
    const result = classifyDeliveryCandidate(facts);
    assert.equal(result.route, "comprehensive", riskName);
    assert.ok(
      result.reasons.some((reason) => reason.includes(riskName)),
      riskName
    );
  }
});

test("large, shared, out-of-app, configuration-unknown, and ambiguous inputs fail closed", () => {
  const cases = [
    [eligibleFacts({ size: "M" }), /size M is not eligible/],
    [eligibleFacts({ dependency_scope: "shared" }), /dependency scope shared/],
    [eligibleFacts({ changed_paths: ["packages/shared/index.js"] }), /outside app root/],
    [eligibleFacts({ configuration_identity: null }), /configuration identity is unknown/],
    [eligibleFacts({ app_root: null }), /app root is unknown/],
  ];
  for (const [facts, reason] of cases) {
    const result = classifyDeliveryCandidate(facts);
    assert.equal(result.route, "comprehensive");
    assert.match(result.reasons.join("\n"), reason);
  }
});

test("missing or malformed risk facts are unknown and therefore comprehensive", () => {
  const missing = eligibleFacts();
  delete missing.risk.auth;
  assert.deepEqual(classifyDeliveryCandidate(null), {
    route: "comprehensive",
    eligible: false,
    reasons: ["delivery candidate facts are missing"],
  });
  const result = classifyDeliveryCandidate(missing);
  assert.equal(result.route, "comprehensive");
  assert.match(result.reasons.join("\n"), /auth risk is unknown/);
});
