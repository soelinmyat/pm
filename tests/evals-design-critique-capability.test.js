"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  scoreCapabilityReport,
  validateCapabilityOracle,
  validateCapabilityReport,
} = require("../scripts/evals/design-critique-capability");

function oracle() {
  return {
    schema_version: 1,
    benchmark_id: "design-critique-hidden-v1",
    minimum_repeats: 3,
    thresholds: {
      p0_p1_recall: 0.9,
      objective_precision: 0.8,
      clean_control_false_block_rate: 0.05,
      locator_accuracy: 0.9,
      severity_accuracy: 0.9,
      claimed_fix_success: 0.9,
    },
    cases: [
      {
        id: "defect-case",
        fixture_ref: "evals/quality/fixtures/design-critique/defect.html",
        fixture_sha256: `sha256:${"a".repeat(64)}`,
        clean_control: false,
        defects: [
          {
            id: "overflow",
            severity: "high",
            objective: true,
            route: "/report",
            state: "narrow",
            locator: ".report",
            fix_oracle: "document.documentElement.scrollWidth <= window.innerWidth",
          },
        ],
      },
      {
        id: "clean-case",
        fixture_ref: "evals/quality/fixtures/design-critique/clean.html",
        fixture_sha256: `sha256:${"b".repeat(64)}`,
        clean_control: true,
        defects: [],
      },
    ],
  };
}

function report({ miss = false, falseBlock = false } = {}) {
  return {
    schema_version: 1,
    benchmark_id: "design-critique-hidden-v1",
    profile: { id: "sol-high", model: "gpt-5.6-sol", effort: "high" },
    repeats: [1, 2, 3].map((repeat) => ({
      repeat,
      cases: [
        {
          case_id: "defect-case",
          blocked: false,
          findings: miss
            ? []
            : [
                {
                  oracle_id: "overflow",
                  severity: "high",
                  objective: true,
                  blocking: true,
                  location_correct: true,
                  claimed_fixed: true,
                  fix_verified: true,
                },
              ],
        },
        {
          case_id: "clean-case",
          blocked: falseBlock,
          findings: falseBlock
            ? [
                {
                  oracle_id: null,
                  severity: "high",
                  objective: true,
                  blocking: true,
                  location_correct: false,
                  claimed_fixed: false,
                  fix_verified: false,
                },
              ]
            : [],
        },
      ],
    })),
  };
}

test("hidden capability oracle and report schemas are closed and validated", () => {
  assert.deepEqual(validateCapabilityOracle(oracle()), []);
  assert.deepEqual(validateCapabilityReport(report(), oracle()), []);
  assert.match(
    validateCapabilityOracle({ ...oracle(), leaked_hint: "overflow" }).join("\n"),
    /unknown field/
  );
  const unbound = oracle();
  delete unbound.cases[0].fixture_sha256;
  assert.match(validateCapabilityOracle(unbound).join("\n"), /missing field fixture_sha256/);
});

test("capability scoring measures recall precision false blocking location severity and fixes", () => {
  const result = scoreCapabilityReport(oracle(), report());
  assert.equal(result.claimable, true);
  assert.equal(result.release_passed, true);
  assert.deepEqual(result.metrics, {
    p0_p1_recall: 1,
    objective_precision: 1,
    clean_control_false_block_rate: 0,
    locator_accuracy: 1,
    severity_accuracy: 1,
    claimed_fix_success: 1,
  });

  const bad = scoreCapabilityReport(oracle(), report({ miss: true, falseBlock: true }));
  assert.equal(bad.claimable, true);
  assert.equal(bad.release_passed, false);
  assert.equal(bad.metrics.p0_p1_recall, 0);
  assert.equal(bad.metrics.clean_control_false_block_rate, 1);
});
