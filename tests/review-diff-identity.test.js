"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { gitExec, trustedDiffArgs } = require("../scripts/lib/git-env");
const {
  DIFF_FORMAT,
  reviewDiffBytes,
  matchesReviewDiff,
} = require("../scripts/lib/review-diff-identity");
const digest = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

test("new diff identity uses full IDs and legacy recovery authenticates exact Git bytes", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-diff-identity-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) => gitExec(root, args).trim();
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.com");
  fs.writeFileSync(path.join(root, "source.js"), "module.exports = 1;\n");
  git("add", "source.js");
  git("commit", "-qm", "base");
  const base = git("rev-parse", "HEAD");
  fs.writeFileSync(path.join(root, "source.js"), "module.exports = 2;\n");
  git("add", "source.js");
  git("commit", "-qm", "head");
  const head = git("rev-parse", "HEAD");
  const range = `${base}...${head}`;
  const full = reviewDiffBytes(root, range);
  assert.match(full.toString(), /^index [a-f0-9]{40}\.\.[a-f0-9]{40} /m);
  const fullHash = digest(full);
  assert.equal(matchesReviewDiff(root, range, fullHash, DIFF_FORMAT), true);
  for (const abbreviation of [7, 9, 10, 12]) {
    const legacy = gitExec(
      root,
      trustedDiffArgs("--binary", `--abbrev=${abbreviation}`, range),
      null
    );
    const legacyHash = digest(legacy);
    assert.notEqual(legacyHash, fullHash);
    assert.equal(matchesReviewDiff(root, range, legacyHash), true);
    assert.equal(matchesReviewDiff(root, range, legacyHash, DIFF_FORMAT), false);
  }
  for (const abbreviation of [7, 9, 10, 12]) {
    git("config", "core.abbrev", String(abbreviation));
    assert.deepEqual(reviewDiffBytes(root, range), full);
  }
  assert.equal(matchesReviewDiff(root, range, fullHash, "unknown-format"), false);
  assert.equal(matchesReviewDiff(root, range, fullHash, null), false);
  assert.equal(matchesReviewDiff(root, range, "not-a-hash"), false);
  assert.equal(matchesReviewDiff(root, range, "0".repeat(64)), false);
  assert.equal(matchesReviewDiff(root, `${head}...${head}`, fullHash), false);
  fs.writeFileSync(path.join(root, "source.js"), "module.exports = 3;\n");
  git("add", "source.js");
  git("commit", "-qm", "changed content");
  assert.equal(matchesReviewDiff(root, `${base}...${git("rev-parse", "HEAD")}`, fullHash), false);
});
