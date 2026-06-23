"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  DEFAULT_LOOP_CONFIG,
  loadLoopConfig,
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
