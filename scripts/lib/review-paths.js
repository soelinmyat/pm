"use strict";

const TARGET_RE = /^(\.pm\/dev-sessions\/[^/]+\/review)\/round-([1-3])\/target\.json$/;

function reviewRootFromTargetPath(targetPath, round) {
  const match = String(targetPath || "").match(TARGET_RE);
  if (!match || Number(match[2]) !== round)
    throw new Error(
      `target path must equal .pm/dev-sessions/{slug}/review/round-${round}/target.json`
    );
  return match[1];
}

function expectedReviewPath(reviewRoot, round, kind, options = {}) {
  const roundRoot = `${reviewRoot}/round-${round}`;
  if (kind === "target") return `${roundRoot}/target.json`;
  if (kind === "result") {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(options.workerId || ""))
      throw new Error("result path requires a kebab-case worker ID");
    return `${roundRoot}/results/${options.workerId}.json`;
  }
  if (kind === "decisions") return `${roundRoot}/decisions.json`;
  if (options.stage === "draft") {
    if (kind === "report") return `${roundRoot}/draft-report.json`;
    if (kind === "human") return `${roundRoot}/draft-report.html`;
  }
  const canonical = options.outcome === "passed";
  if (kind === "report") return `${canonical ? reviewRoot : roundRoot}/report.json`;
  if (kind === "human") return `${canonical ? reviewRoot : roundRoot}/report.html`;
  throw new Error(`unknown Review evidence kind ${kind}`);
}

function expectedPriorReportPath(reviewRoot, round) {
  if (!Number.isInteger(round) || round < 2 || round > 3)
    throw new Error("prior report path requires review round 2 or 3");
  return `${reviewRoot}/round-${round - 1}/report.json`;
}

function requireReviewPath(actual, expected, label = "Review evidence") {
  if (actual !== expected) throw new Error(`${label} path must equal ${expected}`);
  return actual;
}

module.exports = {
  expectedPriorReportPath,
  expectedReviewPath,
  requireReviewPath,
  reviewRootFromTargetPath,
};
