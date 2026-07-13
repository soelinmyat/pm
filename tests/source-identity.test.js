"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const {
  defaultBranchName,
  resolveDeliveryRemote,
  sourceRepository,
} = require("../scripts/source-identity.js");

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

test("default branch resolution uses the authoritative remote HEAD and fails closed", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-source-identity-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const origin = path.join(root, "origin.git");
  const project = path.join(root, "project");
  git(root, ["init", "--bare", "--initial-branch=trunk", origin]);
  git(root, ["clone", origin, project]);
  git(project, ["config", "user.name", "Source Identity Test"]);
  git(project, ["config", "user.email", "source-identity@example.com"]);
  fs.writeFileSync(path.join(project, "README.md"), "fixture\n");
  git(project, ["add", "README.md"]);
  git(project, ["commit", "-m", "fixture"]);
  git(project, ["push", "-u", "origin", "trunk"]);
  git(origin, ["symbolic-ref", "HEAD", "refs/heads/trunk"]);
  git(project, ["remote", "set-head", "origin", "-d"]);
  assert.equal(defaultBranchName(project), "trunk");

  git(origin, ["symbolic-ref", "HEAD", "refs/heads/missing"]);
  assert.equal(defaultBranchName(project), "");

  git(project, ["remote", "set-url", "origin", "https://evil.test/github.com/openai/pm.git"]);
  assert.equal(sourceRepository(project), "");
});

test("delivery identity follows the branch push remote instead of origin", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-delivery-identity-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const origin = path.join(root, "origin.git");
  const delivery = path.join(root, "delivery.git");
  const project = path.join(root, "project");
  git(root, ["init", "--bare", "--initial-branch=main", origin]);
  git(root, ["init", "--bare", "--initial-branch=release", delivery]);
  git(root, ["clone", origin, project]);
  git(project, ["config", "user.name", "Source Identity Test"]);
  git(project, ["config", "user.email", "source-identity@example.com"]);
  fs.writeFileSync(path.join(project, "README.md"), "fixture\n");
  git(project, ["add", "README.md"]);
  git(project, ["commit", "-m", "fixture"]);
  git(project, ["push", "-u", "origin", "HEAD:main"]);
  git(project, ["remote", "add", "delivery", delivery]);
  git(project, ["push", "delivery", "HEAD:release"]);
  git(project, ["config", "branch.main.pushRemote", "delivery"]);

  assert.equal(resolveDeliveryRemote(project, "main"), "delivery");
  assert.equal(defaultBranchName(project, "delivery"), "release");

  const pushTarget = path.join(root, "push-target.git");
  git(root, ["init", "--bare", "--initial-branch=published", pushTarget]);
  git(project, ["push", pushTarget, "HEAD:published"]);
  git(project, ["config", "remote.delivery.pushurl", pushTarget]);
  assert.equal(defaultBranchName(project, "delivery"), "published");
});
