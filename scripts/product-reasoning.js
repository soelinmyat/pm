#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { readProjectInput } = require("./lib/safe-project-output");
const { writeProjectJsonAtomic } = require("./lib/project-atomic-write");
const {
  decisionId,
  featureId,
  promoteDecisionBrief,
  rankIdeaBriefs,
  reconcileFeatureInventory,
  validateDecisionBrief,
  validateFeatureInventory,
} = require("./lib/product-reasoning-schema");

function main(argv = process.argv.slice(2)) {
  try {
    const [command, ...rest] = argv;
    const args = parse(rest);
    let result;
    if (command === "decision-id")
      result = { decision_id: decisionId(required(args, "kind"), required(args, "slug")) };
    else if (command === "feature-id")
      result = { feature_id: featureId(required(args, "project"), required(args, "key")) };
    else if (command === "validate") {
      const value = readJson(required(args, "input"));
      let issues;
      if (value.document_type === "decision-brief") issues = validateDecisionBrief(value);
      else if (value.document_type === "feature-inventory")
        issues = validateFeatureInventory(value);
      else throw new Error("input document_type must be decision-brief or feature-inventory");
      result = { ok: issues.length === 0, issues };
      if (issues.length) process.exitCode = 2;
    } else if (command === "rank-ideas") {
      const request = readJson(required(args, "request"));
      result = { rankings: rankIdeaBriefs(request.ideas || [], request.strategy || null) };
    } else if (command === "reconcile-features") {
      const request = readJson(required(args, "request"));
      result = reconcileFeatureInventory(request.previous || null, request.proposed);
      if (result.ambiguous.length) process.exitCode = 3;
    } else if (command === "promote") {
      const project = path.resolve(required(args, "project"));
      const request = readJson(required(args, "request"));
      result = promote(project, request);
    } else
      throw new Error(
        "command must be decision-id, feature-id, validate, rank-ideas, reconcile-features, or promote"
      );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

function promote(project, request) {
  if (!request || typeof request !== "object" || Array.isArray(request))
    throw new Error("promotion request must be an object");
  const fields = new Set(["decision_path", "target_ref", "confirmed_at", "binding_paths"]);
  for (const field of Object.keys(request))
    if (!fields.has(field)) throw new Error(`promotion request field ${field} is unknown`);
  for (const field of ["decision_path", "target_ref", "confirmed_at"])
    if (typeof request[field] !== "string" || !request[field])
      throw new Error(`promotion request ${field} is required`);
  if (!Array.isArray(request.binding_paths) || request.binding_paths.length === 0)
    throw new Error("promotion request binding_paths must be non-empty");
  if (!request.binding_paths.includes(request.target_ref))
    throw new Error("promotion target_ref must also be a binding path");

  const decisionInput = readProjectInput(project, request.decision_path, 4 * 1024 * 1024);
  const brief = JSON.parse(decisionInput.bytes.toString("utf8"));
  const sourceArtifacts = request.binding_paths.map((bindingPath) => {
    const input = readProjectInput(project, bindingPath, 16 * 1024 * 1024);
    return {
      path: input.relative,
      sha256: `sha256:${crypto.createHash("sha256").update(input.bytes).digest("hex")}`,
    };
  });
  const promoted = promoteDecisionBrief(
    brief,
    request.target_ref,
    sourceArtifacts,
    request.confirmed_at
  );
  writeProjectJsonAtomic(project, request.decision_path, promoted, {
    maxBytes: 4 * 1024 * 1024,
  });
  return {
    promoted: true,
    decision_path: decisionInput.relative,
    target_ref: request.target_ref,
    bindings: sourceArtifacts,
  };
}

function parse(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    if (!flag?.startsWith("--") || argv[i + 1] === undefined)
      throw new Error(`invalid argument ${flag || ""}`);
    out[flag.slice(2).replaceAll("-", "_")] = argv[i + 1];
  }
  return out;
}
function required(args, key) {
  if (!args[key]) throw new Error(`--${key.replaceAll("_", "-")} is required`);
  return args[key];
}
function readJson(file) {
  const resolved = path.resolve(file);
  let descriptor;
  try {
    descriptor = fs.openSync(resolved, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size > 4 * 1024 * 1024)
      throw new Error("input must be a bounded regular JSON file");
    return JSON.parse(fs.readFileSync(descriptor, "utf8"));
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

if (require.main === module) main();
module.exports = { main };
