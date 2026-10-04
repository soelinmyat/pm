"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { cleanGitEnv } = require("../scripts/lib/git-env");
const { planIntegrationImpact } = require("../scripts/review-impact");

function fixture(t, upstreamPath) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-impact-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, env: cleanGitEnv(), encoding: "utf8" }).trim();
  git("init", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.com");
  const write = (name, text) => {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  };
  write("app/feature.js", "old\n");
  write("shared/api.js", "old\n");
  git("add", ".");
  git("commit", "-m", "base");
  const base = git("rev-parse", "HEAD");
  git("checkout", "-b", "feature");
  write("app/feature.js", "new\n");
  git("add", ".");
  git("commit", "-m", "feature");
  const reviewed = git("rev-parse", "HEAD");
  git("checkout", "main");
  write(upstreamPath, "upstream\n");
  git("add", ".");
  git("commit", "-m", "upstream");
  const liveBase = git("rev-parse", "HEAD");
  git("checkout", "feature");
  git("rebase", "main");
  return {
    root,
    liveBase,
    currentCommit: git("rev-parse", "HEAD"),
    target: {
      source: { commit: reviewed, base_commit: base },
      changed_files: [{ path: "app/feature.js" }],
    },
    git,
    write,
  };
}

test("unrelated main advance retains feature review and scopes integration with complete dependencies", (t) => {
  const f = fixture(t, "docs/note.md");
  const result = planIntegrationImpact({
    ...f,
    dependencies: { complete: true, paths: ["app/", "shared/api.js"] },
  });
  assert.equal(result.feature_review, "retain");
  assert.equal(result.integration, "focused");
  assert.deepEqual(result.upstream_paths, ["docs/note.md"]);
  assert.equal(result.exact_head_ci_required, true);
  assert.equal(result.gate_certification, false);
});

test("affected integration changes keep feature evidence and require affected contract checks", (t) => {
  const result = planIntegrationImpact({
    ...fixture(t, "shared/api.js"),
    dependencies: { complete: true, paths: ["app/", "shared/api.js"] },
  });
  assert.equal(result.feature_review, "retain");
  assert.equal(result.integration, "affected-contracts");
  assert.deepEqual(result.affected_paths, ["shared/api.js"]);
});

test("unknown or malformed dependency closure requires full integration validation", (t) => {
  const f = fixture(t, "docs/note.md");
  for (const dependencies of [
    null,
    { complete: false, paths: ["app/"] },
    { complete: true, paths: [] },
    { complete: true, paths: ["../shared"] },
    { complete: true, paths: ["app/"], extra: true },
  ]) {
    assert.equal(planIntegrationImpact({ ...f, dependencies }).integration, "full");
  }
});

test("material feature edits require fresh review even with unaffected upstream", (t) => {
  const f = fixture(t, "docs/note.md");
  f.write("app/feature.js", "material behavior\n");
  f.git("add", ".");
  f.git("commit", "-m", "change");
  const result = planIntegrationImpact({
    ...f,
    currentCommit: f.git("rev-parse", "HEAD"),
    dependencies: { complete: true, paths: ["app/"] },
  });
  assert.equal(result.feature_review, "rerun");
  assert.equal(result.integration, "full");
});
