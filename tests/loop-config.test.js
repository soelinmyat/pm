"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  DEFAULT_LOOP_CONFIG,
  approveExecutionConfig,
  executionConfigHash,
  loadLoopConfig,
  loadTrustedLoopConfig,
  normalizeLoopConfig,
} = require("../scripts/loop-config.js");

test("loop config normalizes malformed object sections back to defaults", () => {
  const config = normalizeLoopConfig({
    autonomy: null,
    wip_limits: "bad",
    budgets: [],
  });

  assert.deepEqual(config.autonomy, DEFAULT_LOOP_CONFIG.autonomy);
  assert.deepEqual(config.wip_limits, DEFAULT_LOOP_CONFIG.wip_limits);
  assert.deepEqual(config.budgets, DEFAULT_LOOP_CONFIG.budgets);
});

test("loadLoopConfig normalizes malformed persisted config sections", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-loop-config-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pmDir = path.join(root, "pm");
  fs.mkdirSync(path.join(pmDir, "loop"), { recursive: true });
  fs.writeFileSync(
    path.join(pmDir, "loop", "config.json"),
    JSON.stringify({ autonomy: null, wip_limits: "bad" })
  );

  const config = loadLoopConfig(pmDir);

  assert.equal(config.autonomy.start_dev, false);
  assert.equal(config.wip_limits.implementing, 1);
});

test("loop config rejects legacy sandbox and add-dir flags that duplicate canonical fields", () => {
  for (const engineArgs of [
    ["--sandbox", "danger-full-access"],
    ["--sandbox=read-only"],
    ["--add-dir", "/tmp/shared"],
    ["--add-dir=/tmp/shared"],
  ]) {
    assert.throws(
      () => normalizeLoopConfig({ version: 2, worker: { engine_args: engineArgs } }),
      /worker\.engine_args.*codex_(sandbox|add_dirs)/
    );
  }
});

test("executable and broad-permission config requires a matching machine-local approval hash", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-loop-trusted-config-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pmDir = path.join(root, "pm");
  const pmStateDir = path.join(root, ".pm");
  fs.mkdirSync(path.join(pmDir, "loop"), { recursive: true });
  fs.writeFileSync(
    path.join(pmDir, "loop", "config.json"),
    JSON.stringify({
      version: 2,
      worker: {
        bootstrap_command: "npm ci",
        codex_sandbox: "danger-full-access",
      },
      preflight: { service_checks: [{ name: "tests", command: "npm test" }] },
    })
  );

  const config = loadLoopConfig(pmDir);
  const firstHash = executionConfigHash(config);
  assert.match(firstHash, /^sha256:[a-f0-9]{64}$/);
  assert.throws(
    () => loadTrustedLoopConfig(pmDir, pmStateDir),
    new RegExp(`local approval.*${firstHash.replace(":", "\\:")}`, "i")
  );

  const approval = approveExecutionConfig(pmStateDir, config);
  assert.equal(approval.approved_execution_config_hash, firstHash);
  assert.equal(loadTrustedLoopConfig(pmDir, pmStateDir).execution_config_hash, firstHash);

  fs.writeFileSync(
    path.join(pmDir, "loop", "config.json"),
    JSON.stringify({ version: 2, worker: { bootstrap_command: "npm ci --ignore-scripts" } })
  );
  const changedHash = executionConfigHash(loadLoopConfig(pmDir));
  assert.notEqual(changedHash, firstHash);
  assert.throws(() => loadTrustedLoopConfig(pmDir, pmStateDir), /local approval/i);
});
