"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { runCaptureProbe } = require("../scripts/design-critique-capture");

for (const outcome of ["success", "failure", "timeout"]) {
  test(`private capture configuration is complete and reclaimed after ${outcome}`, (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "capture-config-test-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const created = [];
    const mkdtemp = fs.mkdtempSync;
    t.mock.method(fs, "mkdtempSync", (...args) => {
      const directory = mkdtemp(...args);
      created.push(directory);
      return directory;
    });
    const payload = "private-configuration-設備\n".repeat(8000);
    const helper = path.join(root, "probe.cjs");
    fs.writeFileSync(
      helper,
      `const fs = require("node:fs"), crypto = require("node:crypto");
const stat = fs.fstatSync(0);
const config = JSON.parse(fs.readFileSync(0, "utf8"));
if (!stat.isFile()) throw new Error("configuration must have deterministic EOF");
if (process.platform !== "win32" && (stat.mode & 0o777) !== 0o600) throw new Error("configuration must be private");
if (${JSON.stringify(outcome)} === "failure") throw new Error("fixture failure");
if (${JSON.stringify(outcome)} === "timeout") setInterval(() => {}, 1000);
else process.stdout.write(JSON.stringify({sha256: crypto.createHash("sha256").update(config.payload).digest("hex")}));`
    );
    const capture = () =>
      runCaptureProbe(
        {
          payload,
          outputPath: path.join(root, "first.png"),
          verificationPath: path.join(root, "second.png"),
        },
        { probePath: helper, timeoutMs: outcome === "timeout" ? 1000 : 5000 }
      );
    if (outcome === "success") {
      assert.deepEqual(capture(), {
        sha256: crypto.createHash("sha256").update(payload).digest("hex"),
      });
    } else {
      assert.throws(capture, outcome === "timeout" ? /ETIMEDOUT/ : /fixture failure/);
    }
    assert.ok(created.length > 0, "capture used owned temporary configuration storage");
    for (const directory of created) assert.equal(fs.existsSync(directory), false);
    assert.equal(fs.existsSync(helper), true, "unrelated files are preserved");
  });
}
