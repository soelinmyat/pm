"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");
const { classifyBaseDrift, classifyGitBaseDrift } = require("../scripts/base-drift");
const { receiptAuthentication } = require("../scripts/lib/repository-capabilities");

const KEY = Buffer.alloc(32, 9);
const EXPECTED = {
  repository: "acme/repo",
  base_commit: "a".repeat(40),
  head_commit: "b".repeat(40),
  result_commit: "c".repeat(40),
};
function receipt(clean = true) {
  const value = {
    schema_version: 1,
    kind: "github-merge-result-v1",
    identity: "merge-result-v1",
    ...EXPECTED,
    clean,
    observed_at: "2026-08-10T00:00:00.000Z",
  };
  return { ...value, authentication: receiptAuthentication(value, KEY) };
}
const OPTIONS = { key: KEY, now: new Date("2026-08-10T00:01:00.000Z") };
const AUTHENTICATED_PATHS = { ...OPTIONS, pathsAuthenticated: true };

test("base drift classifies disjoint, overlapping, conflicting, and indeterminate", () => {
  assert.equal(
    classifyBaseDrift(
      { feature_paths: ["app/a.js"], base_paths: ["docs/b.md"] },
      AUTHENTICATED_PATHS
    ).classification,
    "disjoint"
  );
  assert.equal(
    classifyBaseDrift(
      {
        feature_paths: ["app/a.js"],
        base_paths: ["app/a.js"],
        merge_result: receipt(true),
        merge_expectation: EXPECTED,
      },
      AUTHENTICATED_PATHS
    ).classification,
    "overlapping"
  );
  assert.equal(
    classifyBaseDrift(
      {
        feature_paths: ["app/a.js"],
        base_paths: ["app/a.js"],
        merge_result: receipt(false),
        merge_expectation: EXPECTED,
      },
      AUTHENTICATED_PATHS
    ).classification,
    "conflicting"
  );
  assert.equal(
    classifyBaseDrift({ feature_paths: ["app/a.js"], base_paths: null }).classification,
    "indeterminate"
  );
});

test("review survives disjoint drift but latest-base readiness needs authenticated capability", () => {
  const ordinary = classifyBaseDrift(
    { feature_paths: ["app/a.js"], base_paths: ["docs/b.md"] },
    AUTHENTICATED_PATHS
  );
  assert.equal(ordinary.review_survives, true);
  assert.equal(ordinary.optimized_merge_ready, false);
  assert.match(ordinary.reason, /authenticated merge/i);
  const capable = classifyBaseDrift(
    {
      feature_paths: ["app/a.js"],
      base_paths: ["docs/b.md"],
      merge_result: receipt(true),
      merge_expectation: EXPECTED,
    },
    AUTHENTICATED_PATHS
  );
  assert.equal(capable.optimized_merge_ready, true);
});

test("forged or stale merge capability cannot authorize optimized readiness", () => {
  const forged = { ...receipt(true), identity: "forged" };
  assert.equal(
    classifyBaseDrift(
      { feature_paths: [], base_paths: [], merge_result: forged, merge_expectation: EXPECTED },
      AUTHENTICATED_PATHS
    ).optimized_merge_ready,
    false
  );
  assert.equal(
    classifyBaseDrift(
      {
        feature_paths: [],
        base_paths: [],
        merge_result: receipt(true),
        merge_expectation: EXPECTED,
      },
      { ...AUTHENTICATED_PATHS, now: new Date("2026-08-10T01:00:00Z") }
    ).optimized_merge_ready,
    false
  );
});

test("overlapping drift is never optimized-ready even with a clean authenticated merge result", () => {
  const result = classifyBaseDrift(
    {
      feature_paths: ["app/a.js"],
      base_paths: ["app/a.js"],
      merge_result: receipt(true),
      merge_expectation: EXPECTED,
    },
    AUTHENTICATED_PATHS
  );
  assert.equal(result.classification, "overlapping");
  assert.equal(result.optimized_merge_ready, false);
});

test("caller-supplied empty path arrays cannot preserve Review", () => {
  const result = classifyBaseDrift({ feature_paths: [], base_paths: [] });
  assert.equal(result.classification, "indeterminate");
  assert.equal(result.review_survives, false);
  assert.equal(result.optimized_merge_ready, false);
});

test("production drift derives complete path sets from exact Git commits", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-base-drift-git-"));
  const git = (...args) => childProcess.spawnSync("git", args, { cwd: root, encoding: "utf8" });
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  fs.mkdirSync(path.join(root, "app"));
  fs.writeFileSync(path.join(root, "app/a.js"), "one\n");
  fs.writeFileSync(path.join(root, "base.txt"), "one\n");
  git("add", ".");
  git("commit", "-q", "-m", "base");
  const base = git("rev-parse", "HEAD").stdout.trim();
  git("checkout", "-q", "-b", "feature");
  fs.writeFileSync(path.join(root, "app/a.js"), "feature\n");
  git("add", ".");
  git("commit", "-q", "-m", "feature");
  const head = git("rev-parse", "HEAD").stdout.trim();
  git("checkout", "-q", "-b", "upstream", base);
  fs.writeFileSync(path.join(root, "base.txt"), "two\n");
  git("add", ".");
  git("commit", "-q", "-m", "advance");
  const currentBase = git("rev-parse", "HEAD").stdout.trim();
  const result = classifyGitBaseDrift({
    root,
    previous_base: base,
    current_base: currentBase,
    head,
  });
  assert.equal(result.classification, "disjoint", JSON.stringify(result));
  assert.deepEqual(result.feature_paths, ["app/a.js"]);
  assert.deepEqual(result.base_paths, ["base.txt"]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("base-side renames include both endpoints and cannot appear disjoint", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-base-drift-rename-"));
  const git = (...args) => childProcess.spawnSync("git", args, { cwd: root, encoding: "utf8" });
  try {
    git("init", "-q");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    fs.writeFileSync(path.join(root, "shared.txt"), "one\n");
    git("add", ".");
    git("commit", "-q", "-m", "base");
    const base = git("rev-parse", "HEAD").stdout.trim();
    git("checkout", "-q", "-b", "feature");
    fs.writeFileSync(path.join(root, "shared.txt"), "feature\n");
    git("commit", "-qam", "feature");
    const head = git("rev-parse", "HEAD").stdout.trim();
    git("checkout", "-q", "-b", "upstream", base);
    git("mv", "shared.txt", "renamed.txt");
    git("commit", "-qm", "rename");
    const currentBase = git("rev-parse", "HEAD").stdout.trim();
    const result = classifyGitBaseDrift({
      root,
      previous_base: base,
      current_base: currentBase,
      head,
    });
    assert.equal(result.classification, "overlapping", JSON.stringify(result));
    assert.deepEqual(result.base_paths, ["renamed.txt", "shared.txt"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
