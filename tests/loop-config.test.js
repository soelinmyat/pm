"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  DEFAULT_LOOP_CONFIG,
  approveExecutionConfig,
  claimEnvelopeSeconds,
  executionConfigHash,
  initLoopConfig,
  loadLoopConfig,
  loadTrustedLoopConfig,
  normalizeLoopConfig,
  requiresLocalApproval,
  runLoopConfigEffect,
} = require("../scripts/loop-config.js");

test("lease TTL covers the complete bounded claim-to-final-push envelope", () => {
  const config = normalizeLoopConfig({});
  const envelope = claimEnvelopeSeconds(config, "dev");
  const margin = config.claim_envelope.scheduler_overlap_margin_seconds;

  assert.equal(envelope, 6810);
  assert.ok(config.budgets.lease_ttl_seconds > envelope + margin);
  assert.equal(config.budgets.lease_ttl_seconds, 7200);
  assert.equal("lease_ttl_minutes" in config.budgets, false);
});

test("loop config rejects unsafe TTLs and unbounded post-claim phases", () => {
  assert.throws(
    () =>
      normalizeLoopConfig({
        budgets: { lease_ttl_seconds: 7110 },
      }),
    /lease_ttl_seconds \(7110\) must be greater than claim envelope \(6810\).*margin \(300\)/
  );

  for (const field of [
    "branch_promotion_seconds",
    "bootstrap_recheck_seconds",
    "shutdown_grace_seconds",
    "remote_stop_poll_seconds",
    "artifact_verification_seconds",
    "pm_finalization_seconds",
    "workspace_cleanup_seconds",
  ]) {
    assert.throws(
      () => normalizeLoopConfig({ claim_envelope: { [field]: 0 } }),
      new RegExp(`claim_envelope\\.${field} must be a positive integer`)
    );
  }

  assert.throws(
    () => normalizeLoopConfig({ budgets: { max_identical_no_progress: 0 } }),
    /budgets\.max_identical_no_progress must be a positive integer/
  );
  assert.throws(
    () => normalizeLoopConfig({ canary: { evidence_ttl_seconds: 0 } }),
    /canary\.evidence_ttl_seconds must be a positive integer/
  );
  for (const field of ["max_runs_per_day", "max_ship_cycles_per_day"]) {
    for (const value of [0, -1, 1.5, "twelve"]) {
      assert.throws(
        () => normalizeLoopConfig({ budgets: { [field]: value } }),
        new RegExp(`budgets\\.${field} must be a positive integer`)
      );
    }
  }
  for (const value of [0, -1, 1.5, "thirty", 7, 45, 90, 1500]) {
    assert.throws(
      () => normalizeLoopConfig({ scheduler_interval_minutes: value }),
      /scheduler_interval_minutes.*exact cron interval/i
    );
  }
  for (const value of [1, 5, 30, 60, 120, 360, 720, 1440]) {
    assert.equal(
      normalizeLoopConfig({ scheduler_interval_minutes: value }).scheduler_interval_minutes,
      value
    );
  }
});

test("legacy minute TTLs migrate explicitly and the old 45-minute value fails closed", () => {
  assert.throws(
    () => normalizeLoopConfig({ budgets: { lease_ttl_minutes: 45 } }),
    /lease_ttl_seconds \(2700\) must be greater/
  );

  const migrated = normalizeLoopConfig({ budgets: { lease_ttl_minutes: 120 } });
  assert.equal(migrated.budgets.lease_ttl_seconds, 7200);
  assert.equal("lease_ttl_minutes" in migrated.budgets, false);
});

test("persisted legacy TTLs migrate before defaults merge and loop init creates recovery storage", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-loop-config-migration-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pmDir = path.join(root, "pm");
  fs.mkdirSync(path.join(pmDir, "loop"), { recursive: true });
  fs.writeFileSync(
    path.join(pmDir, "loop", "config.json"),
    JSON.stringify({ version: 1, budgets: { lease_ttl_minutes: 120 } })
  );

  const migrated = loadLoopConfig(pmDir);
  assert.equal(migrated.budgets.lease_ttl_seconds, 7200);
  assert.equal("lease_ttl_minutes" in migrated.budgets, false);

  fs.rmSync(pmDir, { recursive: true, force: true });
  initLoopConfig(pmDir);
  assert.equal(fs.existsSync(path.join(pmDir, "loop", "recovery")), true);
});

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
    ["-s", "danger-full-access"],
    ["-s=read-only"],
    ["--add-dir", "/tmp/shared"],
    ["--add-dir=/tmp/shared"],
  ]) {
    assert.throws(
      () => normalizeLoopConfig({ version: 2, worker: { engine_args: engineArgs } }),
      /worker\.engine_args.*codex_(sandbox|add_dirs)/
    );
  }
});

test("sandbox values are exact enums and runtime switches require local approval", () => {
  for (const codexSandbox of ["danger-full-access ", " workspace-write", "unknown"]) {
    assert.throws(
      () => normalizeLoopConfig({ version: 2, worker: { codex_sandbox: codexSandbox } }),
      /worker\.codex_sandbox.*read-only.*workspace-write.*danger-full-access/
    );
  }

  assert.equal(requiresLocalApproval(normalizeLoopConfig({ default_runtime: "claude" })), true);
  assert.equal(requiresLocalApproval(normalizeLoopConfig({ worker: { engine: "claude" } })), true);
});

test("execution config hash covers selection, prompt, claim, and runtime budget behavior", () => {
  const baseline = normalizeLoopConfig({ autonomy: { start_dev: true } });
  for (const changed of [
    normalizeLoopConfig({ autonomy: { start_dev: true, merge_pr: true } }),
    normalizeLoopConfig({ autonomy: { start_dev: true }, budgets: { max_runs_per_day: 2 } }),
    normalizeLoopConfig({ autonomy: { start_dev: true }, wip_limits: { implementing: 2 } }),
  ]) {
    assert.notEqual(executionConfigHash(changed), executionConfigHash(baseline));
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

test("host approval is journaled and a verified approval replays without rewriting", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-loop-config-effect-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pmDir = path.join(root, "pm");
  const pmStateDir = path.join(root, ".pm");
  fs.mkdirSync(path.join(pmDir, "loop"), { recursive: true });
  fs.writeFileSync(
    path.join(pmDir, "loop", "config.json"),
    JSON.stringify({ version: 2, worker: { bootstrap_command: "npm test" } })
  );
  const options = {
    action: "approve-host",
    pmDir,
    pmStateDir,
    authorityActions: ["approve_loop_host"],
  };
  const first = runLoopConfigEffect(options);
  const hostPath = path.join(pmStateDir, "loop-host.json");
  const firstMtime = fs.statSync(hostPath).mtimeMs;
  const second = runLoopConfigEffect(options);

  assert.equal(first.state, "verified");
  assert.equal(second.replayed, true);
  assert.equal(fs.statSync(hostPath).mtimeMs, firstMtime);
  assert.equal(fs.statSync(first.journal_path).mode & 0o777, 0o600);
  assert.equal(second.verified_receipt.effect, "approve-loop-host");
});
