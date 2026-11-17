#!/usr/bin/env node
"use strict";

// Trusted-local observations, like Review itself. This record never supplies
// human approval, rewrites a report, or certifies the next source commit.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { readProjectInput, writeProjectJsonAtomic } = require("./lib/project-file");
const { isRfc3339DateTime } = require("./lib/iso-time");
const { stableStringify } = require("./lib/workflow-runtime/records");
const { recoveryRequiresDecision } = require("./lib/scoped-recovery");
const LIMIT = 4 * 1024 * 1024;
const active = new Set();
const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
function read(root, relative) {
  const bytes = readProjectInput(root, relative, LIMIT).bytes;
  return { value: JSON.parse(bytes), binding: { path: relative, sha256: hash(bytes) } };
}
function same(left, right) {
  return stableStringify(left) === stableStringify(right);
}
function compute(root, reportPath, resultPaths) {
  if (
    !Array.isArray(resultPaths) ||
    resultPaths.length < 2 ||
    resultPaths.length > 6 ||
    new Set(resultPaths).size !== resultPaths.length
  )
    throw new Error("complete distinct reviewer result paths are required");
  const original = read(root, reportPath);
  if (active.has(reportPath) || active.size >= 8)
    throw new Error("classification resolution history exceeds budget");
  active.add(reportPath);
  try {
    const { checkReview, expandFromReport } = require("./review-check");
    const frozen = {
      root,
      verifyGit: false,
      verifyFrozenGit: true,
      validateOnly: true,
      verifyBrowser: false,
    };
    const checked = checkReview(expandFromReport({ ...frozen, reportPath, fromReport: true }));
    if (!checked.ok)
      throw new Error(`original Review is invalid: ${JSON.stringify(checked.issues)}`);
    const old = original.value;
    if (reportPath !== `${path.posix.dirname(old.target.path)}/report.json`)
      throw new Error("only a finalized immutable round report can be reconciled");
    const target = read(root, old.target.path).value;
    if (
      old.outcome !== "blocked" ||
      !old.unresolved_disagreements?.length ||
      old.decisions ||
      recoveryRequiresDecision(target.recovery) ||
      old.findings.some((finding) => finding.decision_required || finding.fix_kind === "decision")
    )
      throw new Error(
        "only reviewer classification disagreement can be resolved; decision authority remains blocked"
      );
    const kinds = new Set(
      old.findings
        .filter((finding) => old.unresolved_disagreements.includes(finding.id))
        .flatMap((finding) => finding.signals.map((signal) => signal.fix_kind))
    );
    if (kinds.size !== 2 || !kinds.has("mechanical") || !kinds.has("behavioral"))
      throw new Error(
        "original disagreement is not a mechanical/behavioral classification mismatch"
      );
    const revised = checkReview({ ...frozen, targetPath: old.target.path, resultPaths });
    if (!revised.ok)
      throw new Error(`clarification evidence is invalid: ${JSON.stringify(revised.issues)}`);
    const report = revised.report;
    if (
      !["passed", "failed"].includes(report.outcome) ||
      old.unresolved_disagreements.some(
        (id) =>
          !report.findings.some(
            (finding) =>
              finding.id === id && finding.agreed_fix_kind === "behavioral" && !finding.disputed
          )
      )
    )
      throw new Error(
        "complete peer agreement and stricter behavioral classification are required; other disputes remain blocked"
      );
    return {
      original_report: original.binding,
      results: report.results,
      outcome: report.outcome,
      resolved_ids: [...old.unresolved_disagreements].sort(),
    };
  } finally {
    active.delete(reportPath);
  }
}
function verifyClassificationResolution(root, binding, priorReport) {
  const input = read(root, binding?.path);
  if (!same(input.binding, binding)) throw new Error("classification resolution binding changed");
  const value = input.value;
  const fields = [
    "schema_version",
    "kind",
    "original_report",
    "results",
    "outcome",
    "resolved_ids",
    "checked_at",
  ];
  if (
    !value ||
    Object.keys(value).some((field) => !fields.includes(field)) ||
    value.schema_version !== 1 ||
    value.kind !== "review-classification-resolution" ||
    !isRfc3339DateTime(value.checked_at) ||
    !same(value.original_report, priorReport) ||
    !Array.isArray(value.results)
  )
    throw new Error("classification resolution must bind the exact predecessor report");
  if (binding.path !== `${path.posix.dirname(priorReport.path)}/classification-resolution.json`)
    throw new Error("classification resolution path must belong to the predecessor round");
  for (const item of value.results)
    if (!same(read(root, item.path).binding, item))
      throw new Error("clarified result binding changed");
  const expected = compute(
    root,
    priorReport.path,
    value.results.map((item) => item.path)
  );
  for (const field of ["original_report", "results", "outcome", "resolved_ids"])
    if (!same(value[field], expected[field]))
      throw new Error(`classification resolution ${field} does not match checked evidence`);
  return expected;
}
function createClassificationResolution({ root = process.cwd(), reportPath, resultPaths }) {
  root = fs.realpathSync(root);
  const material = compute(root, reportPath, resultPaths);
  const relative = `${path.posix.dirname(reportPath)}/classification-resolution.json`;
  const value = {
    schema_version: 1,
    kind: "review-classification-resolution",
    ...material,
    checked_at: new Date().toISOString(),
  };
  writeProjectJsonAtomic(root, relative, value, {
    replace: false,
    fileMode: 0o600,
    directoryMode: 0o700,
  });
  return { path: relative, sha256: hash(readProjectInput(root, relative, LIMIT).bytes) };
}
function main(argv = process.argv.slice(2)) {
  const args = { resultPaths: [] };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i],
      value = argv[i + 1];
    if (!value || !["--root", "--report", "--result", "--check"].includes(flag))
      throw new Error(
        "use --root PATH --report PATH and either --result PATH (repeat for every reviewer) or --check PATH"
      );
    if (flag === "--result") args.resultPaths.push(value);
    else args[flag === "--root" ? "root" : flag === "--check" ? "checkPath" : "reportPath"] = value;
  }
  if (!args.reportPath) throw new Error("frozen report path is required");
  if (args.checkPath && args.resultPaths.length)
    throw new Error("check and creation inputs cannot be mixed");
  const result = args.checkPath
    ? verifyClassificationResolution(
        args.root || process.cwd(),
        read(args.root || process.cwd(), args.checkPath).binding,
        read(args.root || process.cwd(), args.reportPath).binding
      )
    : createClassificationResolution(args);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
module.exports = { createClassificationResolution, verifyClassificationResolution };

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
