"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { routeDevWork } = require("../scripts/lib/dev-risk");

const STEP_DIR = path.join(__dirname, "..", "skills", "dev", "steps");

test("task and bug may skip readiness but cannot erase risk safeguards", () => {
  const lowTask = routeDevWork({ kind: "task", size: "S", risk: { behavioral: 1 } });
  const highBug = routeDevWork({
    kind: "bug",
    size: "XS",
    risk: { security: 2, external_contract: 2 },
  });
  assert.ok(!lowTask.required_phases.includes("readiness"));
  assert.equal(lowTask.review_mode, "code-scan");
  assert.equal(highBug.review_mode, "full");
  assert.ok(highBug.required_gates.includes("verification"));
});

test("M+ proposal readiness remains routed before implementation", () => {
  const route = routeDevWork({ kind: "proposal", size: "M", risk: { behavioral: 1 } });
  assert.ok(
    route.required_phases.indexOf("readiness") < route.required_phases.indexOf("implementation")
  );
});

test("step contracts consume executable routing rather than kind-wins prose", () => {
  const intake = fs.readFileSync(path.join(STEP_DIR, "02-intake.md"), "utf8");
  const review = fs.readFileSync(path.join(STEP_DIR, "07-review.md"), "utf8");
  assert.match(intake, /Kind affects readiness inputs, not safety gates/);
  assert.match(review, /session\.routing\.review_mode/);
  assert.match(review, /do not recompute it from kind or size/);
  assert.doesNotMatch(intake, /kind wins/i);
});
