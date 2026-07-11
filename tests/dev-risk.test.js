"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { assessRisk, routeDevWork } = require("../scripts/lib/dev-risk");

test("assessRisk: defaults missing dimensions to zero without mutating input", () => {
  const facts = { behavioral: 1 };
  const result = assessRisk(facts);

  assert.equal(result.tier, "low");
  assert.equal(result.dimensions.behavioral, 1);
  assert.equal(result.dimensions.security, 0);
  assert.deepEqual(facts, { behavioral: 1 });
});

test("assessRisk: rejects unknown dimensions and scores outside zero through three", () => {
  assert.throws(() => assessRisk({ mystery: 1 }), /unknown risk dimension: mystery/);
  assert.throws(() => assessRisk({ security: 4 }), /security must be an integer from 0 to 3/);
});

test("assessRisk: security, auth, destructive data, and irreversible changes force high risk", () => {
  for (const risk of [
    { security: 2 },
    { auth: 1 },
    { destructive_data: true },
    { data: 2, destructive_data: true },
    { reversibility: 3 },
  ]) {
    const result = assessRisk(risk);
    assert.ok(["high", "critical"].includes(result.tier), JSON.stringify(risk));
    assert.ok(result.reasons.length > 0);
  }
});

test("assessRisk: aggregate cross-cutting risk raises the tier deterministically", () => {
  const first = assessRisk({ behavioral: 2, external_contract: 2, operational: 2 });
  const second = assessRisk({ operational: 2, behavioral: 2, external_contract: 2 });

  assert.equal(first.tier, "high");
  assert.deepEqual(first, second);
});

test("routeDevWork: low-risk XS docs work skips TDD with a reason but keeps review and verification", () => {
  const route = routeDevWork({
    kind: "task",
    size: "XS",
    risk: {},
    non_behavioral_reason: "docs-only",
  });

  assert.equal(route.risk_tier, "low");
  assert.equal(route.review_mode, "code-scan");
  assert.ok(!route.required_gates.includes("tdd"));
  assert.deepEqual(route.required_gates, ["review", "verification"]);
  assert.match(route.reasons.join("\n"), /TDD skipped: docs-only/);
});

test("routeDevWork: a behavioral bug requires TDD even when size is XS", () => {
  const route = routeDevWork({ kind: "bug", size: "XS", risk: { behavioral: 1 } });

  assert.ok(route.required_gates.includes("tdd"));
  assert.ok(route.required_gates.includes("review"));
  assert.ok(route.required_gates.includes("verification"));
});

test("routeDevWork: kind cannot erase full review for a high-risk task", () => {
  const route = routeDevWork({
    kind: "task",
    size: "S",
    risk: { security: 2, external_contract: 2 },
  });

  assert.equal(route.risk_tier, "high");
  assert.equal(route.review_mode, "full");
  assert.ok(route.required_gates.includes("review"));
  assert.ok(route.required_gates.includes("verification"));
  assert.match(route.reasons.join("\n"), /high risk requires full review/i);
});

test("routeDevWork: a public contract break promotes even XS work to full review", () => {
  const route = routeDevWork({
    kind: "bug",
    size: "XS",
    risk: { external_contract: 2 },
  });
  assert.equal(route.risk_tier, "high");
  assert.equal(route.review_mode, "full");
});

test("routeDevWork: M+ proposals require readiness while tasks with clear scope do not", () => {
  const proposal = routeDevWork({ kind: "proposal", size: "M", risk: { behavioral: 1 } });
  const task = routeDevWork({ kind: "task", size: "L", risk: { behavioral: 1 } });

  assert.ok(proposal.required_phases.includes("readiness"));
  assert.ok(!task.required_phases.includes("readiness"));
  assert.equal(task.review_mode, "full");
});

test("routeDevWork: UI risk adds design critique and QA once", () => {
  const route = routeDevWork({ kind: "proposal", size: "M", risk: { behavioral: 2, ui: 2 } });

  assert.equal(route.required_gates.filter((gate) => gate === "design-critique").length, 1);
  assert.equal(route.required_gates.filter((gate) => gate === "qa").length, 1);
  assert.deepEqual(route.required_phases.slice(-5), [
    "design-critique",
    "qa",
    "review",
    "ship",
    "retro",
  ]);
});

test("routeDevWork: returns a stable decision record with readable reasons", () => {
  const route = routeDevWork({ kind: "proposal", size: "M", risk: { cross_module: 2 } });

  assert.equal(route.decision_version, 1);
  assert.deepEqual(route.required_phases, [
    "intake",
    "workspace",
    "readiness",
    "implementation",
    "review",
    "ship",
    "retro",
  ]);
  assert.ok(route.reasons.every((reason) => typeof reason === "string" && reason.length > 0));
});
