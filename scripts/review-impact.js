#!/usr/bin/env node
"use strict";

// Advisory integration planning. This never certifies or writes a delivery gate.
const path = require("node:path");
const { contentIdentity, changedTreePaths, isAncestor } = require("./lib/review-freshness");
const { readProjectInput } = require("./lib/project-file");

function dependencyClosure(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => ["complete", "paths"].includes(key)) &&
    value.complete === true &&
    Array.isArray(value.paths) &&
    value.paths.length > 0 &&
    value.paths.every(
      (name) =>
        typeof name === "string" &&
        name.length > 0 &&
        !name.startsWith("/") &&
        !name.includes("\\") &&
        !/[\0\r\n*?]/.test(name) &&
        name
          .replace(/\/$/, "")
          .split("/")
          .every((part) => part && part !== "." && part !== "..")
    )
  );
}

function planIntegrationImpact({ root, target, currentCommit, liveBase, dependencies = null }) {
  const result = {
    schema_version: 1,
    gate_certification: false,
    commit: currentCommit,
    base_commit: liveBase,
    feature_review: "rerun",
    integration: "full",
    exact_head_ci_required: true,
    upstream_paths: [],
    affected_paths: [],
    reasons: [],
  };
  try {
    if (!isAncestor(root, target?.source?.base_commit, liveBase)) {
      result.reasons.push("Upstream ancestry is uncertain; perform full validation");
      return result;
    }
    const identity = contentIdentity({ root, target, currentCommit, currentBaseCommit: liveBase });
    result.feature_review = identity.ok ? "retain" : "rerun";
    result.reasons.push(identity.reason);
    const changed = changedTreePaths(root, target.source.base_commit, liveBase).changed;
    result.upstream_paths = [...changed]
      .map((bytes) => {
        const name = Buffer.from(bytes, "latin1").toString("utf8");
        if (Buffer.from(name, "utf8").toString("latin1") !== bytes)
          throw new Error("Upstream path cannot be represented without loss");
        return name;
      })
      .sort();
    if (!identity.ok || !dependencyClosure(dependencies)) {
      result.reasons.push(
        "Changed feature or incomplete dependency/contract coverage requires full validation"
      );
      return result;
    }
    // The closure must include the reviewed source itself, including old rename paths.
    const covers = (name) =>
      dependencies.paths.some((entry) =>
        entry.endsWith("/") ? name.startsWith(entry) : entry === name
      );
    if (
      !Array.isArray(target.changed_files) ||
      target.changed_files.length === 0 ||
      target.changed_files.some(
        (row) => !covers(row.path) || (row.old_path && !covers(row.old_path))
      )
    ) {
      result.reasons.push("Dependency closure omits reviewed paths; perform full validation");
      return result;
    }
    result.affected_paths = result.upstream_paths.filter(covers);
    result.integration = result.affected_paths.length ? "affected-contracts" : "focused";
    result.reasons.push(
      result.affected_paths.length
        ? "Recheck changed dependencies and their affected contracts; retain unchanged feature review"
        : "No upstream path intersects the declared complete closure; retain feature review and run focused integration checks"
    );
    return result;
  } catch (error) {
    result.feature_review = "rerun";
    result.integration = "full";
    result.reasons.push(`Impact could not be established: ${error.message}`);
    return result;
  }
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    const options = {};
    for (let index = 0; index < args.length; index += 2) {
      if (
        !["--root", "--target", "--commit", "--base", "--dependencies"].includes(args[index]) ||
        !args[index + 1] ||
        Object.hasOwn(options, args[index])
      )
        throw new Error(
          "Usage: review-impact.js --root <repo> --target <relative-json> --commit <sha> --base <sha> [--dependencies <relative-json>]"
        );
      options[args[index]] = args[index + 1];
    }
    if (!["--target", "--commit", "--base"].every((name) => options[name]))
      throw new Error("target, commit and base are required");
    const root = path.resolve(options["--root"] || process.cwd());
    const read = (name) =>
      JSON.parse(readProjectInput(root, name, 4 * 1024 * 1024).bytes.toString("utf8"));
    process.stdout.write(
      JSON.stringify(
        planIntegrationImpact({
          root,
          target: read(options["--target"]),
          currentCommit: options["--commit"],
          liveBase: options["--base"],
          dependencies: options["--dependencies"] ? read(options["--dependencies"]) : null,
        }),
        null,
        2
      ) + "\n"
    );
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}
module.exports = { planIntegrationImpact };
