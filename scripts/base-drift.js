#!/usr/bin/env node
"use strict";

const { verifyMergeResultReceipt } = require("./pr-state.js");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const SHA = /^[0-9a-f]{40,64}$/i;

function validPaths(value) {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string" && item && !item.includes("\0"))
  );
}

function classifyBaseDrift(input = {}, options = {}) {
  if (options.pathsAuthenticated !== true)
    return {
      classification: "indeterminate",
      review_survives: false,
      optimized_merge_ready: false,
      reason:
        "changed-path evidence is not authenticated to exact commits; derive it from Git or a trusted provider",
    };
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
    optimized_merge_ready: Boolean(capable && classification === "disjoint"),
    reason: capable
      ? "authenticated current merge result proves latest-base readiness"
      : "authenticated merge-result or merge-queue capability is unavailable; use comprehensive handling",
  };
}

function git(root, args) {
  const result = childProcess.spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    shell: false,
    timeout: 5000,
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0)
    throw new Error(`Git drift evidence unavailable: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

function changedPaths(root, range) {
  const result = childProcess.spawnSync(
    "git",
    ["-c", "core.quotepath=false", "diff", "--name-status", "-z", "--no-ext-diff", range, "--"],
    { cwd: root, encoding: null, shell: false, timeout: 5000, maxBuffer: 1024 * 1024 }
  );
  if (result.status !== 0)
    throw new Error(`Git drift evidence unavailable: ${String(result.stderr || "").trim()}`);
  const fields = result.stdout.toString("utf8").split("\0");
  if (fields.at(-1) !== "") throw new Error("Git drift paths are malformed");
  fields.pop();
  const paths = [];
  for (let index = 0; index < fields.length; ) {
    const status = fields[index++];
    if (!/^[A-Z][0-9]*$/.test(status || "")) throw new Error("Git drift status is malformed");
    const count = /^[RC]/.test(status) ? 2 : 1;
    for (let offset = 0; offset < count; offset++) {
      const value = fields[index++];
      if (!value || value.includes("\0")) throw new Error("Git drift paths are malformed");
      paths.push(value);
    }
  }
  return [...new Set(paths)].sort();
}

function classifyGitBaseDrift(input, options = {}) {
  const root = fs.realpathSync(path.resolve(input.root));
  for (const field of ["previous_base", "current_base", "head"])
    if (!SHA.test(input[field] || "")) throw new Error(`${field} must be an exact commit`);
  for (const commit of [input.previous_base, input.current_base, input.head])
    if (git(root, ["rev-parse", "--verify", `${commit}^{commit}`]) !== commit)
      throw new Error("drift commit identity mismatch");
  git(root, ["merge-base", "--is-ancestor", input.previous_base, input.current_base]);
  const featurePaths = changedPaths(root, `${input.previous_base}...${input.head}`);
  const basePaths = changedPaths(root, `${input.previous_base}..${input.current_base}`);
  const result = classifyBaseDrift(
    {
      feature_paths: featurePaths,
      base_paths: basePaths,
      merge_result: input.merge_result,
      merge_expectation: input.merge_expectation,
    },
    { ...options, pathsAuthenticated: true }
  );
  return {
    ...result,
    previous_base: input.previous_base,
    current_base: input.current_base,
    head: input.head,
    feature_paths: featurePaths,
    base_paths: basePaths,
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
      `${JSON.stringify(classifyGitBaseDrift(JSON.parse(input), { key: process.env.PM_MERGE_RESULT_RECEIPT_KEY }))}\n`
    )
  );
}

if (require.main === module) main();
module.exports = { classifyBaseDrift, classifyGitBaseDrift };
