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
  generate,
  installGenerated,
  installCron,
  launchdLabel,
  projectSlug,
  resumeScheduler,
  setKillSwitch,
} = require("../scripts/loop-install.js");
const { evaluateCanaryReleaseGate } = require("../scripts/loop-canary.js");
const { normalizeLoopConfig } = require("../scripts/loop-config.js");

const REQUIRED_ASSERTIONS = {
  "preflight-failure": {
    exact_plan_preserved: true,
    exact_card_preserved: true,
    engine_argv_pinned: true,
    identity_unchanged: true,
    worker_preflight_failed: true,
    pm_head_unchanged: true,
    card_unchanged: true,
    leases_unchanged: true,
  },
  "blocked-result": {
    exact_plan_preserved: true,
    exact_card_preserved: true,
    engine_argv_pinned: true,
    identity_unchanged: true,
    worker_blocked: true,
    card_needs_human: true,
    remediation_present: true,
    no_lease: true,
    durable_blocked_event: true,
    blocked_ledger: true,
  },
  "verified-pr": {
    exact_plan_preserved: true,
    exact_card_preserved: true,
    engine_argv_pinned: true,
    identity_unchanged: true,
    worker_completed: true,
    card_shipping: true,
    no_lease: true,
    no_recovery: true,
    durable_completed_event: true,
    completed_ledger: true,
    verified_open_pr: true,
    merge_disabled: true,
  },
};

function inventory(records = []) {
  return {
    count: records.length,
    sha256: `sha256:${"4".repeat(64)}`,
    records,
  };
}

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
    exact_plan_config_hash: `sha256:${"b".repeat(64)}`,
    engine: {
      kind: "codex",
      binary_version: "codex 1.0.0",
      argv_hash: `sha256:${"d".repeat(64)}`,
    },
    before: {
      pm_head: "f".repeat(40),
      card: {
        relative_path: "pm/backlog/canary.md",
        sha256: `sha256:${"1".repeat(64)}`,
        status: "ready",
        blocker_code: "",
        blocker_remediation: "",
      },
      leases: inventory(),
      recovery: inventory(),
      events: inventory(),
    },
    after: {
      pm_head: "f".repeat(40),
      card: {
        relative_path: "pm/backlog/canary.md",
        sha256: `sha256:${(caseName === "preflight-failure" ? "1" : "2").repeat(64)}`,
        status:
          caseName === "blocked-result"
            ? "needs-human"
            : caseName === "verified-pr"
              ? "shipping"
              : "ready",
        blocker_code: caseName === "blocked-result" ? "fixture-blocked" : "",
        blocker_remediation: caseName === "blocked-result" ? "Resolve the fixture blocker." : "",
      },
      leases: inventory(),
      recovery: inventory(),
      events: inventory(
        caseName === "preflight-failure"
          ? []
          : [
              {
                path: `pm/loop/events/${runId}.json`,
                sha256: `sha256:${"3".repeat(64)}`,
                value: {
                  run_id: runId,
                  status: caseName === "blocked-result" ? "blocked" : "completed",
                  terminal: true,
                },
              },
            ]
      ),
    },
    worker_result: {
      run_id: runId,
      status:
        caseName === "preflight-failure"
          ? "preflight-failed"
          : caseName === "blocked-result"
            ? "blocked"
            : "completed",
      fingerprint: `sha256:${"c".repeat(64)}`,
      card: { id: "PM-CANARY" },
    },
    ledger:
      caseName === "preflight-failure"
        ? { path: "", sha256: "" }
        : { path: "run.json", sha256: `sha256:${"e".repeat(64)}` },
    assertions: REQUIRED_ASSERTIONS[caseName],
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
  assert.match(mac.instructions, /preview only/i);
  assert.doesNotMatch(mac.instructions, /launchctl load/i);
  assert.match(linux.instructions, /preview only/i);
  assert.doesNotMatch(linux.instructions, /crontab -e/i);
});

test("install exposure reports daily claim envelope, TTL margin, and unsafe autonomy warnings", () => {
  const config = normalizeLoopConfig({
    autonomy: { merge_pr: true },
    worker: { engine_bin: "/opt/custom-engine", codex_sandbox: "danger-full-access" },
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
  assert.ok(exposure.warnings.some((warning) => /custom engine/i.test(warning)));

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

test("gated cron installation is idempotent and owns scheduler activation", () => {
  const calls = [];
  const result = installCron("*/30 * * * * node worker.js", {
    run(_bin, args, options) {
      calls.push({ args, input: options?.input || "" });
      if (args[0] === "-l") return "0 0 * * * backup\n";
      return "";
    },
  });
  assert.equal(result, "crontab");
  assert.deepEqual(calls[0].args, ["-l"]);
  assert.deepEqual(calls[1].args, ["-"]);
  assert.match(calls[1].input, /backup/);
  assert.match(calls[1].input, /node worker\.js/);
});

test("resume emits exposure before removing STOP and includes it in the result", () => {
  const config = normalizeLoopConfig({
    autonomy: { merge_pr: true },
    worker: { engine_bin: "/opt/custom-engine" },
  });
  const events = [];
  const result = resumeScheduler("/tmp/pm", config, {
    writeError(text) {
      events.push(`warning:${/merge autonomy/i.test(text)}:${/custom engine/i.test(text)}`);
    },
    setStop(pmDir, stopped) {
      events.push(`resume:${pmDir}:${stopped}`);
      return { stopPath: `${pmDir}/loop/STOP`, stopped, committed: true, pushed: true };
    },
  });
  assert.equal(events[0], "warning:true:true");
  assert.equal(events[1], "resume:/tmp/pm:false");
  assert.deepEqual(result.exposure, buildInstallExposure(config));
});

test("direct launchd install emits exposure warnings before enabling the scheduler", () => {
  const config = normalizeLoopConfig({
    autonomy: { merge_pr: true },
    worker: { codex_sandbox: "danger-full-access" },
  });
  const generated = generate({
    projectDir: "/p",
    mode: "dev",
    intervalMinutes: 30,
    format: "launchd",
    config,
  });
  const events = [];
  const result = installGenerated(generated, 30, {
    install(content, label) {
      events.push(`install:${label}:${content.includes("<plist")}`);
      return "/tmp/com.pm.loop.p.plist";
    },
    writeError(text) {
      events.push(`warning:${/merge autonomy/i.test(text)}:${/danger-full-access/i.test(text)}`);
    },
  });
  assert.match(events[0], /^warning:true:true$/);
  assert.match(events[1], /^install:/);
  assert.deepEqual(result.exposure, generated.exposure);
  assert.equal(result.installed, true);
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
