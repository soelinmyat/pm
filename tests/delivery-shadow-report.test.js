"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { buildShadowReport } = require("../scripts/delivery-shadow-report");

function delivery(index, overrides = {}) {
  return {
    id: `delivery-${index}`,
    size: index % 2 ? "XS" : "S",
    app: index % 2 ? "mobile" : "api",
    actual_route: "comprehensive",
    proposed_route: "optimized",
    actual: { implementation_complete_to_merge_ready_ms: 1000 + index, certification_count: 2 },
    proposed: { implementation_complete_to_merge_ready_ms: 400 + index, certification_count: 1 },
    ...overrides,
  };
}

test("requires at least twenty eligible XS/S deliveries", () => {
  const report = buildShadowReport([
    ...Array.from({ length: 19 }, (_, index) => delivery(index)),
    { id: "ignored-medium", size: "M" },
  ]);
  assert.equal(report.status, "insufficient-sample");
  assert.equal(report.eligible_deliveries, 19);
  assert.equal(report.threshold.evaluated, false);
});

test("reports deterministic medians by route and app and evaluates fifty percent improvement", () => {
  const records = Array.from({ length: 20 }, (_, index) => delivery(index));
  records.push(delivery(99, { size: "M" }));
  const report = buildShadowReport(records.reverse());
  assert.equal(report.status, "evaluated");
  assert.equal(report.eligible_deliveries, 20);
  assert.equal(report.threshold.required_improvement_percent, 50);
  assert.equal(report.threshold.passed, true);
  assert.ok(report.threshold.observed_improvement_percent >= 50);
  assert.deepEqual(
    report.by_route_app.map((row) => `${row.route}:${row.app}`),
    ["comprehensive:api", "comprehensive:mobile", "optimized:api", "optimized:mobile"]
  );
  assert.ok(report.by_route_app.every((row) => Number.isFinite(row.median_time_ms)));
  assert.ok(report.by_route_app.every((row) => Number.isFinite(row.median_certification_count)));
});

test("does not claim rollout when the approved threshold is missed", () => {
  const records = Array.from({ length: 20 }, (_, index) =>
    delivery(index, {
      proposed: { implementation_complete_to_merge_ready_ms: 700 + index, certification_count: 2 },
    })
  );
  const report = buildShadowReport(records);
  assert.equal(report.threshold.evaluated, true);
  assert.equal(report.threshold.passed, false);
});

test("rejects duplicate delivery identities instead of inflating the rollout sample", () => {
  const records = Array.from({ length: 19 }, (_, index) => delivery(index));
  records.push(delivery(0));
  assert.throws(() => buildShadowReport(records), /duplicate delivery id/i);
});
