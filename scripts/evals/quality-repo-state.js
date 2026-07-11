#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

function snapshot(root) {
  const value = observe(root);
  const target = path.join(root, ".git", "pm-eval-quality-baseline.json");
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  return value;
}

function check(root) {
  const target = path.join(root, ".git", "pm-eval-quality-baseline.json");
  const expected = JSON.parse(fs.readFileSync(target, "utf8"));
  const actual = observe(root);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `repository state changed: expected ${JSON.stringify(expected)}, observed ${JSON.stringify(actual)}`
    );
  }
  return true;
}

function observe(root) {
  return {
    head: git(root, ["rev-parse", "HEAD"]),
    status: git(root, ["status", "--porcelain=v1", "--untracked-files=all"]),
    remote_refs: fs.existsSync(path.join(root, ".pm", "quality", "origin.git"))
      ? git(root, [
          "--git-dir=.pm/quality/origin.git",
          "for-each-ref",
          "--format=%(refname) %(objectname)",
          "refs/heads",
          "refs/tags",
        ])
      : "",
  };
}

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function main(argv) {
  try {
    const [command, rootArg] = argv;
    const root = fs.realpathSync(rootArg || process.cwd());
    if (command === "snapshot") snapshot(root);
    else if (command === "check") check(root);
    else throw new Error("usage: quality-repo-state.js <snapshot|check> [root]");
    return 0;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { check, observe, snapshot };
