"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  buildInstallExposure,
  buildCronLine,
  buildLaunchdPlist,
  evaluateCanaryReleaseGate,
  generate,
  launchdLabel,
  projectSlug,
  setKillSwitch,
} = require("../scripts/loop-install.js");
const { normalizeLoopConfig } = require("../scripts/loop-config.js");

function writeCanaryRecord(pmStateDir, runId, caseName, overrides = {}) {
  const dir = path.join(pmStateDir, "loop-canary", runId);
  fs.mkdirSync(dir, { recursive: true });
  const record = {
    schema_version: 1,
    case: caseName,
    started_at: "2026-07-10T01:00:00.000Z",
    ended_at: "2026-07-10T01:01:00.000Z",
    plugin_version: "1.13.2",
    source_commit: "a".repeat(40),
    execution_config_hash: `sha256:${"b".repeat(64)}`,
    exact_plan_fingerprint: `sha256:${"c".repeat(64)}`,
    engine: {
      kind: "codex",
      binary_version: "codex 1.0.0",
      argv_hash: `sha256:${"d".repeat(64)}`,
    },
    before: {},
    after: {},
    worker_result: {},
    ledger: { path: "run.json", sha256: `sha256:${"e".repeat(64)}` },
    assertions: { contract: true },
    passed: true,
    ...overrides,
  };
  fs.writeFileSync(path.join(dir, `${caseName}.json`), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

test("projectSlug and launchdLabel derive stable identifiers", () => {
  assert.equal(projectSlug("/Users/x/Projects/cleanlog-mono"), "cleanlog-mono");
  assert.equal(launchdLabel("/Users/x/My App!"), "com.pm.loop.my-app");
});

test("launchd plist embeds absolute paths, interval, and PATH env", () => {
  const plist = buildLaunchdPlist({
    projectDir: "/work/proj",
    workerScript: "/plugin/scripts/loop-worker.js",
    nodeBin: "/usr/local/bin/node",
    mode: "dev",
    intervalMinutes: 45,
    logPath: "/tmp/loop.log",
    pathEnv: "/usr/local/bin:/usr/bin",
  });
  assert.match(plist, /<string>com\.pm\.loop\.proj<\/string>/);
  assert.match(plist, /<string>\/usr\/local\/bin\/node<\/string>/);
  assert.match(plist, /<string>\/plugin\/scripts\/loop-worker\.js<\/string>/);
  assert.match(plist, /<string>--project-dir<\/string>/);
  assert.match(plist, /<integer>2700<\/integer>/);
  assert.match(plist, /<key>PATH<\/key>/);
  assert.match(plist, /<string>\/usr\/local\/bin:\/usr\/bin<\/string>/);
});

test("cron line uses */N for sub-hour and hourly schedule above 60m", () => {
  const line30 = buildCronLine({
    projectDir: "/work/proj",
    workerScript: "/plugin/scripts/loop-worker.js",
    nodeBin: "/usr/bin/node",
    intervalMinutes: 30,
    logPath: "/tmp/loop.log",
    pathEnv: "/usr/bin",
  });
  assert.match(line30, /^\*\/30 \* \* \* \* /);
  assert.match(line30, /--project-dir \/work\/proj --mode default >> \/tmp\/loop\.log 2>&1$/);

  const line120 = buildCronLine({
    projectDir: "/work/proj",
    workerScript: "/plugin/scripts/loop-worker.js",
    intervalMinutes: 120,
  });
  assert.match(line120, /^0 \*\/2 \* \* \* /);
});

test("generate picks launchd on darwin format and cron otherwise", () => {
  const mac = generate({ projectDir: "/p", mode: "dev", intervalMinutes: 30, format: "launchd" });
  assert.equal(mac.kind, "launchd");
  assert.match(mac.content, /<plist/);

  const linux = generate({ projectDir: "/p", mode: "dev", intervalMinutes: 30, format: "cron" });
  assert.equal(linux.kind, "cron");
  assert.match(linux.content, /^\*\/30/);
});

test("install exposure reports daily claim envelope, TTL margin, and unsafe autonomy warnings", () => {
  const config = normalizeLoopConfig({
    autonomy: { merge_pr: true },
    worker: { codex_sandbox: "danger-full-access" },
  });
  const exposure = buildInstallExposure(config);
  assert.equal(exposure.claim_envelope_seconds.dev, 6270);
  assert.equal(exposure.claim_envelope_seconds.ship, 2670);
  assert.equal(exposure.maximum_daily_claim_envelope_seconds, 139320);
  assert.equal(exposure.lease_ttl_seconds, 7200);
  assert.equal(exposure.minimum_ttl_seconds, 6571);
  assert.equal(exposure.ttl_margin_seconds, 630);
  assert.ok(exposure.warnings.some((warning) => /merge autonomy/i.test(warning)));
  assert.ok(exposure.warnings.some((warning) => /danger-full-access/i.test(warning)));

  const generated = generate({
    projectDir: "/p",
    mode: "dev",
    intervalMinutes: 30,
    format: "cron",
    config,
  });
  assert.deepEqual(generated.exposure, exposure);
  assert.match(generated.instructions, /maximum daily claim envelope/i);
});

test("canary release gate requires fresh same-identity evidence for all three cases", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-loop-canary-gate-"));
  try {
    const cases = ["preflight-failure", "blocked-result", "verified-pr"];
    const records = cases.map((caseName, index) =>
      writeCanaryRecord(root, `loop-canary-${index}`, caseName)
    );
    const expectedIdentity = {
      plugin_version: records[0].plugin_version,
      source_commit: records[0].source_commit,
      execution_config_hash: records[0].execution_config_hash,
      engine: records[0].engine,
    };
    const passing = evaluateCanaryReleaseGate(root, expectedIdentity, {
      now: new Date("2026-07-10T02:00:00.000Z"),
      maxAgeSeconds: 7200,
    });
    assert.equal(passing.passed, true, JSON.stringify(passing));
    assert.deepEqual(passing.cases.sort(), cases.sort());

    fs.rmSync(path.join(root, "loop-canary", "loop-canary-2", "verified-pr.json"));
    assert.equal(
      evaluateCanaryReleaseGate(root, expectedIdentity, {
        now: new Date("2026-07-10T02:00:00.000Z"),
        maxAgeSeconds: 7200,
      }).passed,
      false,
      "missing evidence fails closed"
    );

    const mixed = writeCanaryRecord(root, "loop-canary-mixed", "verified-pr", {
      source_commit: "f".repeat(40),
    });
    assert.equal(mixed.case, "verified-pr");
    const mixedGate = evaluateCanaryReleaseGate(root, expectedIdentity, {
      now: new Date("2026-07-10T02:00:00.000Z"),
      maxAgeSeconds: 7200,
    });
    assert.equal(mixedGate.passed, false);
    assert.match(mixedGate.reason, /identity/i);

    fs.rmSync(path.join(root, "loop-canary", "loop-canary-mixed"), {
      recursive: true,
      force: true,
    });
    writeCanaryRecord(root, "loop-canary-stale", "verified-pr", {
      started_at: "2026-07-01T01:00:00.000Z",
      ended_at: "2026-07-01T01:01:00.000Z",
    });
    const staleGate = evaluateCanaryReleaseGate(root, expectedIdentity, {
      now: new Date("2026-07-10T02:00:00.000Z"),
      maxAgeSeconds: 7200,
    });
    assert.equal(staleGate.passed, false);
    assert.match(staleGate.reason, /stale/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("setKillSwitch writes and removes the STOP file", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-loop-install-"));
  const pmDir = path.join(root, "pm");
  fs.mkdirSync(path.join(pmDir, "loop"), { recursive: true });
  try {
    const stopped = setKillSwitch(pmDir, true);
    assert.equal(stopped.stopped, true);
    assert.ok(fs.existsSync(stopped.stopPath));

    const resumed = setKillSwitch(pmDir, false);
    assert.equal(resumed.stopped, false);
    assert.equal(fs.existsSync(resumed.stopPath), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
