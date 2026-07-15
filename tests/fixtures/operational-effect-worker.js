"use strict";

const fs = require("node:fs");

const { runOperationalEffect } = require("../../scripts/lib/operational-effect-journal.js");

const [stateDir, markerPath, releasePath, mutationPath] = process.argv.slice(2);
const pause = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);

const result = runOperationalEffect({
  pmStateDir: stateDir,
  workflow: "test",
  effect: "exclusive-mutation",
  authorityAction: "mutate_fixture",
  authorityActions: ["mutate_fixture"],
  target: { file: "fixture" },
  intent: { value: "done" },
  precondition: { value: fs.existsSync(mutationPath) ? "done" : "absent" },
  recovery: { code: "inspect-fixture", command: "retry fixture" },
  lockTimeoutMs: process.env.PM_TEST_LOCK_TIMEOUT_MS
    ? Number(process.env.PM_TEST_LOCK_TIMEOUT_MS)
    : undefined,
  observe() {
    return fs.existsSync(mutationPath)
      ? { state: "verified", receipt: { value: "done" } }
      : { state: "absent", safe_to_retry: true, reason: "fixture is absent" };
  },
  mutate() {
    fs.appendFileSync(mutationPath, `${process.pid}\n`);
    fs.writeFileSync(markerPath, String(process.pid));
    while (!fs.existsSync(releasePath)) pause();
  },
});

process.stdout.write(`${JSON.stringify(result)}\n`);
