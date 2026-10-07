"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { boundTargetGeneratorVersion, buildCanonicalReport } = require("../scripts/review-check");
const { version } = require("../plugin.config.json");
test("released Review generator bounds survive the current minor without admitting future versions", () => {
  for (const supported of ["1.13.22", "1.13.56", "1.13.88", version])
    assert.equal(boundTargetGeneratorVersion(supported), true, supported);
  const future = version.split(".").map(Number);
  future[2] += 1;
  for (const unsupported of ["1.13.21", future.join("."), "01.14.0", "1.14.0-beta", null])
    assert.equal(boundTargetGeneratorVersion(unsupported), false, String(unsupported));
});
test("current acceptance-bound behavioral repairs retain the original eligibility floor", () => {
  const finding = {
    id: "rv-version",
    owner: "review",
    disposition: "open",
    severity: "high",
    confidence: 95,
    disputed: false,
    decision_required: false,
    fix_kind: "behavioral",
    issue: "Bound acceptance contract failure",
  };
  for (const generator of ["1.13.55", "1.13.56", version]) {
    const report = buildCanonicalReport(
      {
        run_id: "version-probe",
        review_round: 1,
        iteration_cap: 3,
        recovery_policy: "scoped-diagnosis-v1",
        generator: { name: "pm:review", version: generator },
        dev_context: { acceptance_sha256: "a".repeat(64) },
        lenses: [],
      },
      { relative: "target.json", sha256: "b".repeat(64) },
      [],
      null,
      { findings: [finding], unresolved_disagreements: [] },
      "report.html"
    );
    assert.deepEqual(report.auto_fix_eligible, generator === "1.13.55" ? [] : [finding.id]);
  }
});
