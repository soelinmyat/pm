"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { check, snapshot } = require("../scripts/evals/quality-repo-state.js");

test("quality repository snapshot rejects committed and untracked mutation", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-quality-repo-state-"));
  try {
    git(root, ["init", "-q", "-b", "main"]);
    git(root, ["config", "user.email", "eval@example.com"]);
    git(root, ["config", "user.name", "PM Eval"]);
    fs.writeFileSync(path.join(root, "tracked.txt"), "before\n");
    git(root, ["add", "tracked.txt"]);
    git(root, ["commit", "-qm", "base"]);
    snapshot(root);
    assert.equal(check(root), true);

    fs.writeFileSync(path.join(root, "tracked.txt"), "after\n");
    git(root, ["add", "tracked.txt"]);
    git(root, ["commit", "-qm", "forbidden mutation"]);
    assert.throws(() => check(root), /repository state changed/);

    git(root, ["reset", "--hard", "HEAD~1"]);
    fs.writeFileSync(path.join(root, "untracked.txt"), "unexpected\n");
    assert.throws(() => check(root), /repository state changed/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}
