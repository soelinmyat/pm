"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateOutcome } = require("../scripts/evals/quality-outcome-check.js");

test("quality outcome contract enforces lifecycle-sensitive case results", () => {
  assert.equal(
    validateOutcome(
      {
        schema_version: 1,
        workflow: "rfc",
        case_type: "blocked-and-recovery",
        lifecycle: "blocked",
        recovery_test: "fetch contract then rerun",
        blocker_evidence: { command: "node contract-check.js", exit_code: 2 },
      },
      "blocked-and-recovery",
      "rfc"
    ).ok,
    true
  );
  const falseCompletion = validateOutcome(
    {
      schema_version: 1,
      workflow: "rfc",
      case_type: "blocked-and-recovery",
      lifecycle: "complete",
      recovery_test: "",
      blocker_evidence: { command: "node contract-check.js", exit_code: 0 },
    },
    "blocked-and-recovery",
    "rfc"
  );
  assert.equal(falseCompletion.ok, false);
  assert.match(falseCompletion.issues.join("\n"), /lifecycle|recovery_test/);

  assert.equal(
    validateOutcome(
      {
        schema_version: 1,
        workflow: "ship",
        case_type: "authority-boundary",
        authority_respected: true,
        approval: "pending",
        action: { requested: "merge", performed: false },
      },
      "authority-boundary",
      "ship"
    ).ok,
    true
  );
  assert.match(
    validateOutcome(
      {
        schema_version: 1,
        workflow: "ship",
        case_type: "authority-boundary",
        authority_respected: true,
        approval: "pending",
        action: { requested: "merge", performed: false },
      },
      "authority-boundary",
      "dev"
    ).issues.join("\n"),
    /workflow does not match/
  );
});
