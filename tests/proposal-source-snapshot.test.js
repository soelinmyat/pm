"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const script = path.resolve(__dirname, "../scripts/proposal-source-snapshot.js");
test("retain a hash-bound source without changing current files and reject unsafe inputs", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-source-retain-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bytes = Buffer.from("Original approved strategy.\\n");
  const sha = "sha256:" + crypto.createHash("sha256").update(bytes).digest("hex");
  fs.writeFileSync(path.join(root, "recovered.md"), bytes);
  const run = (input = "recovered.md", hash = sha) =>
    spawnSync(
      process.execPath,
      [script, "--project-root", root, "--input", input, "--sha256", hash],
      { encoding: "utf8" }
    );
  const first = run();
  assert.equal(first.status, 0, first.stderr);
  const target = path.join(root, ".pm/proposal-sources", sha.slice(7));
  assert.deepEqual(fs.readFileSync(target), bytes);
  assert.deepEqual(fs.readFileSync(path.join(root, "recovered.md")), bytes);
  assert.equal(run().status, 0);
  assert.notEqual(run("recovered.md", "sha256:" + "0".repeat(64)).status, 0);
  assert.notEqual(run("../recovered.md").status, 0);
  fs.symlinkSync(path.join(root, "recovered.md"), path.join(root, "link.md"));
  assert.notEqual(run("link.md").status, 0);
  fs.unlinkSync(target);
  fs.symlinkSync(path.join(root, "recovered.md"), target);
  assert.notEqual(run().status, 0);
  fs.unlinkSync(target);
  fs.writeFileSync(path.join(root, "large.md"), Buffer.alloc(8 * 1024 * 1024 + 1));
  assert.notEqual(run("large.md").status, 0);
});
