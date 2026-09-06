"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { reviewPresentationPolicy } = require("../scripts/lib/review-presentation");

function input() {
  const generator = { name: "pm:review", version: "1.13.52" };
  const source = { commit: "a".repeat(40) };
  return {
    target: {
      schema_version: 2,
      relevance_policy: "changed-hunk-anchor-v1",
      generator,
      source,
      changed_files: [{ path: "scripts/parser.js" }],
      lenses: [{ name: "bug", applicable: true }],
    },
    report: {
      schema_version: 1,
      generator,
      source,
      outcome: "passed",
      findings: [],
      blockers: [],
      unresolved_disagreements: [],
    },
  };
}

test("bounded passing source report is compact without dropping logical lenses", () => {
  const value = input();
  assert.equal(reviewPresentationPolicy(value).mode, "compact");
  value.report.findings = [
    {
      severity: "medium",
      disputed: false,
      decision_required: false,
      decision: null,
      issue: "Keep the parser contract stable.",
    },
  ];
  assert.equal(reviewPresentationPolicy(value).mode, "compact");
});

test("unknown, risky, renamed presentation and complex report inputs require full evidence", () => {
  const mutations = [
    (value) => {
      value.target.schema_version = 1;
    },
    (value) => {
      delete value.target.changed_files;
    },
    (value) => {
      value.target.changed_files[0].old_path = "references/templates/review-report.html";
    },
    (value) => {
      value.target.changed_files[0].path = "scripts/artifact-render-check.js";
    },
    (value) => {
      value.target.lenses.push({ name: "security", applicable: true });
    },
    (value) => {
      value.target.lenses.push({ name: "design", applicable: true });
    },
    (value) => {
      value.target.lenses.push({ name: "future", applicable: true });
    },
    (value) => {
      value.report.outcome = "blocked";
    },
    (value) => {
      value.report.findings = Array(3).fill({});
    },
    (value) => {
      value.report.top_issue = "x".repeat(161);
    },
    (value) => {
      value.report.top_issue = "<script>alert(1)</script>";
    },
    (value) => {
      value.report.top_issue = "x ".repeat(501);
    },
    (value) => {
      value.report.findings = [{ severity: "high" }];
    },
    (value) => {
      value.report.findings = [
        { severity: "low", disputed: false, decision_required: true, decision: null },
      ];
    },
  ];
  for (const mutate of mutations) {
    const value = input();
    mutate(value);
    assert.equal(reviewPresentationPolicy(value).mode, "full", mutate.toString());
  }
});
