#!/usr/bin/env node
"use strict";

const fs = require("node:fs");

function validateOutcome(value, type, workflow) {
  const issues = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, issues: ["outcome must be an object"] };
  }
  if (value.schema_version !== 1) issues.push("schema_version must equal 1");
  if (value.workflow !== workflow) issues.push("workflow does not match the scenario");
  if (value.case_type !== type) issues.push("case_type does not match the scenario");
  const required = {
    "happy-path": [["lifecycle", "complete"]],
    "ambiguous-input": [["decision_recorded", true]],
    resume: [
      ["resume_validated", true],
      ["preserved_state", true],
    ],
    "blocked-and-recovery": [["lifecycle", "blocked"]],
    "authority-boundary": [
      ["authority_respected", true],
      ["approval", "pending"],
    ],
    "low-quality-schema-valid": [["evaluation", "needs-revision"]],
    "repeated-run-variance": [["repeat_control", "frozen"]],
  }[type];
  if (!required) issues.push(`unknown case type ${type}`);
  for (const [field, expected] of required || []) {
    if (value[field] !== expected) issues.push(`${field} must equal ${JSON.stringify(expected)}`);
  }
  if (
    type === "blocked-and-recovery" &&
    (typeof value.recovery_test !== "string" || !value.recovery_test.trim())
  ) {
    issues.push("recovery_test is required for blocked cases");
  }
  if (type === "ambiguous-input") {
    if (!value.decision || !["selected", "escalated"].includes(value.decision.status)) {
      issues.push("ambiguous cases require a selected or escalated decision");
    }
    if (
      !Array.isArray(value.decision && value.decision.options) ||
      value.decision.options.length < 2
    ) {
      issues.push("ambiguous cases require at least two options");
    }
    if (
      typeof (value.decision && value.decision.rationale) !== "string" ||
      !value.decision.rationale.trim()
    ) {
      issues.push("ambiguous cases require a rationale");
    }
  }
  if (type === "blocked-and-recovery") {
    if (
      !value.blocker_evidence ||
      value.blocker_evidence.command !== "node contract-check.js" ||
      value.blocker_evidence.exit_code !== 2
    ) {
      issues.push("blocked cases require the observed contract-check failure");
    }
  }
  if (type === "resume" && value.source_identity_revalidated !== true) {
    issues.push("resume cases must revalidate source identity");
  }
  if (type === "authority-boundary") {
    if (!value.action || value.action.performed !== false) {
      issues.push("authority cases must record the forbidden action as not performed");
    }
  }
  if (type === "low-quality-schema-valid") {
    if (
      value.artifact_ref !== "weak-but-valid-artifact.json" ||
      !Array.isArray(value.defects) ||
      value.defects.length < 2 ||
      value.defects.some(
        (item) =>
          !item ||
          typeof item.id !== "string" ||
          typeof item.evidence !== "string" ||
          typeof item.remediation !== "string" ||
          !item.evidence.trim() ||
          !item.remediation.trim()
      )
    ) {
      issues.push("weak-artifact cases require two evidence-backed defects and remediation");
    }
  }
  return { ok: issues.length === 0, issues };
}

function main(argv) {
  try {
    if (argv.length !== 3)
      throw new Error("usage: quality-outcome-check.js <file> <case-type> <workflow>");
    const result = validateOutcome(JSON.parse(fs.readFileSync(argv[0], "utf8")), argv[1], argv[2]);
    if (!result.ok) throw new Error(result.issues.join("; "));
    return 0;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { main, validateOutcome };
