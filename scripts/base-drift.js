#!/usr/bin/env node
"use strict";

const { verifyMergeResultReceipt } = require("./pr-state.js");

function validPaths(value) {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string" && item && !item.includes("\0"))
  );
}

function classifyBaseDrift(input = {}, options = {}) {
  if (!validPaths(input.feature_paths) || !validPaths(input.base_paths))
    return {
      classification: "indeterminate",
      review_survives: false,
      optimized_merge_ready: false,
      reason:
        "changed-path evidence is unavailable or malformed; use comprehensive update and recertification",
    };
  const base = new Set(input.base_paths);
  const overlap = input.feature_paths.filter((file) => base.has(file));
  let classification = overlap.length === 0 ? "disjoint" : "overlapping";
  const receipt = verifyMergeResultReceipt(
    input.merge_result,
    input.merge_expectation || {},
    options
  );
  if (overlap.length && receipt.authenticated && receipt.clean === false)
    classification = "conflicting";
  const capable = receipt.authenticated && receipt.clean === true && receipt.identity;
  return {
    classification,
    overlapping_paths: overlap.sort(),
    review_survives: classification === "disjoint",
    optimized_merge_ready: Boolean(capable),
    reason: capable
      ? "authenticated current merge result proves latest-base readiness"
      : "authenticated merge-result or merge-queue capability is unavailable; use comprehensive handling",
  };
}

function main() {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    input += chunk;
    if (input.length > 1024 * 1024) process.exit(1);
  });
  process.stdin.on("end", () =>
    process.stdout.write(
      `${JSON.stringify(classifyBaseDrift(JSON.parse(input), { key: process.env.PM_MERGE_RESULT_RECEIPT_KEY }))}\n`
    )
  );
}

if (require.main === module) main();
module.exports = { classifyBaseDrift };
