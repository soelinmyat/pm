"use strict";

const fs = require("node:fs");

const { runOperationalEffect } = require("../../scripts/lib/operational-effect-journal.js");

const [stateDir, markerPath, releasePath, mutationPath] = process.argv.slice(2);
const value = process.env.PM_TEST_EFFECT_VALUE || "done";
const pause = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);

const result = runOperationalEffect({
  pmStateDir: stateDir,
  workflow: "test",
  effect: "exclusive-mutation",
  authorityAction: "mutate_fixture",
  authorityActions: ["mutate_fixture"],
  serializationRoot: process.env.PM_TEST_SERIALIZATION_ROOT || undefined,
  serializationScope: { resource: "fixture", file: "fixture" },
  target: { file: "fixture" },
  intent: { value },
  precondition: () => ({ value: fs.existsSync(mutationPath) ? "present" : "absent" }),
  recovery: { code: "inspect-fixture", command: "retry fixture" },
  lockTimeoutMs: process.env.PM_TEST_LOCK_TIMEOUT_MS
    ? Number(process.env.PM_TEST_LOCK_TIMEOUT_MS)
    : undefined,
  observe() {
    const values = fs.existsSync(mutationPath)
      ? fs.readFileSync(mutationPath, "utf8").trim().split("\n")
      : [];
    return values.includes(value)
      ? { state: "verified", receipt: { value } }
      : { state: "absent", safe_to_retry: true, reason: "fixture is absent" };
  },
  mutate() {
    fs.appendFileSync(mutationPath, `${value}\n`);
    fs.writeFileSync(markerPath, String(process.pid));
    while (!fs.existsSync(releasePath)) pause();
  },
});

process.stdout.write(`${JSON.stringify(result)}\n`);
