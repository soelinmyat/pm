"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { recoverDesign, recoveredDesign, snapshotDesign } = require("../scripts/review-upstream");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-review-upstream-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const targetPath = ".pm/dev-sessions/example/review/runs/original/round-1/target.json";
  const designPath = ".pm/dev-sessions/example/design-critique/report.json";
  const archive = ".pm/dev-sessions/example/design-critique/historical/report.json";
  const bytes = Buffer.from(JSON.stringify({ commit: "a".repeat(40), outcome: "passed" }));
  const write = (relative, value) => {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), value);
  };
  write(designPath, bytes);
  write(archive, bytes);
  const target = {
    run_id: "original",
    review_round: 1,
    upstream: {
      design_critique: {
        path: designPath,
        sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
        commit: "a".repeat(40),
        outcome: "passed",
      },
    },
  };
  write(targetPath, JSON.stringify(target));
  return { root, targetPath, designPath, archive, bytes, target, write };
}

test("new upstream snapshot survives canonical replacement and refuses changed bytes", (t) => {
  const f = fixture(t);
  snapshotDesign(f.root, f.targetPath, f.target);
  assert.match(f.target.upstream.design_critique.path, /round-1\/upstream\/design-critique.json$/);
  f.write(f.designPath, "{}");
  assert.deepEqual(
    fs.readFileSync(path.join(f.root, f.target.upstream.design_critique.path)),
    f.bytes
  );
  snapshotDesign(f.root, f.targetPath, f.target); // identical retry is safe
  const changed = Buffer.from(JSON.stringify({ commit: "b".repeat(40), outcome: "passed" }));
  f.write(f.designPath, changed);
  f.target.upstream.design_critique = {
    path: f.designPath,
    sha256: crypto.createHash("sha256").update(changed).digest("hex"),
    commit: "b".repeat(40),
    outcome: "passed",
  };
  assert.throws(() => snapshotDesign(f.root, f.targetPath, f.target), /immutable upstream/);
});

test("legacy recovery preserves target and canonical bytes and binds its audit record", (t) => {
  const f = fixture(t);
  const originalTarget = fs.readFileSync(path.join(f.root, f.targetPath));
  f.write(f.designPath, '{"commit":"new"}');
  const result = recoverDesign(f.root, f.targetPath, f.archive);
  assert.equal(recoveredDesign(f.root, f.targetPath, f.target).commit, "a".repeat(40));
  assert.deepEqual(fs.readFileSync(path.join(f.root, f.targetPath)), originalTarget);
  assert.equal(fs.readFileSync(path.join(f.root, f.designPath), "utf8"), '{"commit":"new"}');
  assert.throws(() => recoverDesign(f.root, f.targetPath, f.archive), /EEXIST|exist/);
  const record = result.record;
  record.target.sha256 = "0".repeat(64);
  f.write(result.path, JSON.stringify(record));
  assert.throws(() => recoveredDesign(f.root, f.targetPath, f.target), /original target binding/);
});

test("legacy recovery rejects missing, changed and semantically mismatched evidence", (t) => {
  const f = fixture(t);
  assert.throws(() => recoverDesign(f.root, f.targetPath, "missing.json"), /ENOENT/);
  f.write(f.archive, "{}");
  assert.throws(() => recoverDesign(f.root, f.targetPath, f.archive), /original SHA-256/);
  f.write(f.archive, f.bytes);
  f.target.upstream.design_critique.outcome = "failed";
  f.write(f.targetPath, JSON.stringify(f.target));
  assert.throws(
    () => recoverDesign(f.root, f.targetPath, f.archive),
    /original commit and outcome/
  );
});

test("legacy recovery rejects unsafe paths and rechecks archive and snapshot bytes", (t) => {
  const f = fixture(t);
  const linked = ".pm/linked.json";
  fs.symlinkSync(path.join(f.root, f.archive), path.join(f.root, linked));
  assert.throws(() => recoverDesign(f.root, f.targetPath, linked), /symlink/);
  assert.throws(
    () => recoverDesign(f.root, f.targetPath, `../${path.basename(f.root)}/${f.archive}`),
    /path|relative|traversal/i
  );
  const result = recoverDesign(f.root, f.targetPath, f.archive);
  f.write(result.record.snapshot.path, "{}");
  assert.throws(() => recoveredDesign(f.root, f.targetPath, f.target), /original SHA-256/);
  f.write(result.record.snapshot.path, f.bytes);
  f.write(f.archive, "{}");
  assert.throws(() => recoveredDesign(f.root, f.targetPath, f.target), /original SHA-256/);
});
