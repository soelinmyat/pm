"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const STEP = fs.readFileSync(path.join(ROOT, "skills/dev/steps/05-implementation.md"), "utf8");
const REFERENCE = fs.readFileSync(
  path.join(ROOT, "skills/dev/references/multi-task-dispatch.md"),
  "utf8"
);

test("multi-work-unit reference is lazy-loaded only for a validated multi-unit session", () => {
  assert.ok(fs.existsSync(path.join(ROOT, "skills/dev/references/multi-task-dispatch.md")));
  assert.match(
    STEP,
    /Read `multi-task-dispatch\.md` only when more than one validated work unit exists/
  );
  assert.doesNotMatch(REFERENCE, /^order:/m);
});

test("dispatch is a dependency and ownership DAG rather than forced sequential subprocess churn", () => {
  assert.match(REFERENCE, /validateWorkUnits/);
  assert.match(REFERENCE, /analyzeWorkUnits/);
  assert.match(REFERENCE, /Dispatch only `runnable`/);
  assert.match(REFERENCE, /ownership conflicts clear/);
  assert.match(REFERENCE, /deterministic DAG order/);
});

test("workers receive phase-local prompts and cannot own delivery effects", () => {
  assert.match(REFERENCE, /phase-local prompt/);
  assert.match(REFERENCE, /unit-specific acceptance criteria/);
  assert.match(
    REFERENCE,
    /Push, PR, merge, tracker updates, and aggregate gate changes are always false/
  );
  assert.match(REFERENCE, /`merged` is not valid worker authority/);
});

test("results, retries, and compatibility behavior are explicit", () => {
  assert.match(REFERENCE, /schema-valid terminal results/);
  assert.match(REFERENCE, /failed result consumes a bounded retry/);
  assert.match(REFERENCE, /blocked stops dependent units/);
  assert.match(
    REFERENCE,
    /Legacy PID, crash, quota, and old result-file handling remain supported/
  );
});
