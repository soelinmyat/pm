"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  canonicalEngineArgv,
  currentCanaryIdentity,
  runCanary,
  validateEvidenceRecord,
} = require("../scripts/loop-canary.js");
const { executionConfigHash, normalizeLoopConfig, sha256 } = require("../scripts/loop-config.js");

const defaultIdentityConfig = normalizeLoopConfig({ autonomy: { merge_pr: false } });

const identity = {
  plugin_version: "1.13.6",
  source_commit: "a".repeat(40),
  execution_config_hash: `sha256:${"b".repeat(64)}`,
  engine: {
    kind: "codex",
    binary_version: "codex 1.0.0",
    argv_hash: sha256(JSON.stringify(canonicalEngineArgv(defaultIdentityConfig))),
  },
};

function inventory(records = []) {
  return {
    count: records.length,
    sha256: sha256(
      JSON.stringify(records.map(({ path: recordPath, sha256: digest }) => [recordPath, digest]))
    ),
    records,
  };
}

function state({ status = "ready", runId = "", eventStatus = "" } = {}) {
  return {
    pm_head: "d".repeat(40),
    card: {
      relative_path: "pm/backlog/card.md",
      sha256: `sha256:${"e".repeat(64)}`,
      status,
      blocker_code: status === "needs-human" ? "db-unreachable" : "",
      blocker_remediation: status === "needs-human" ? "Start the database." : "",
    },
    leases: inventory(),
    recovery: inventory(),
    events: inventory(
      runId && eventStatus
        ? [
            {
              path: `pm/loop/events/${runId}.json`,
              sha256: `sha256:${"f".repeat(64)}`,
              value: { run_id: runId, status: eventStatus, terminal: true },
            },
          ]
        : []
    ),
  };
}

function completeRecord(caseName) {
  const runId = `loop-${caseName.replace(/[^a-z]/g, "a")}-12345678`;
  const before = state();
  const after =
    caseName === "preflight-failure"
      ? before
      : state({
          status: caseName === "blocked-result" ? "needs-human" : "shipping",
          runId,
          eventStatus: caseName === "blocked-result" ? "blocked" : "completed",
        });
  const assertions =
    caseName === "preflight-failure"
      ? {
          exact_plan_preserved: true,
          exact_card_preserved: true,
          engine_argv_pinned: true,
          worker_preflight_failed: true,
          pm_head_unchanged: true,
          card_unchanged: true,
          leases_unchanged: true,
        }
      : caseName === "blocked-result"
        ? {
            exact_plan_preserved: true,
            exact_card_preserved: true,
            engine_argv_pinned: true,
            worker_blocked: true,
            card_needs_human: true,
            remediation_present: true,
            no_lease: true,
            durable_blocked_event: true,
            blocked_ledger: true,
          }
        : {
            exact_plan_preserved: true,
            exact_card_preserved: true,
            engine_argv_pinned: true,
            worker_completed: true,
            card_shipping: true,
            no_lease: true,
            no_recovery: true,
            durable_completed_event: true,
            completed_ledger: true,
            verified_open_pr: true,
            merge_disabled: true,
          };
  return {
    schema_version: 1,
    case: caseName,
    started_at: "2026-07-10T01:00:00.000Z",
    ended_at: "2026-07-10T01:01:00.000Z",
    ...identity,
    exact_plan_fingerprint: `sha256:${"9".repeat(64)}`,
    exact_plan_config_hash: identity.execution_config_hash,
    before,
    after,
    worker_result: {
      run_id: runId,
      status:
        caseName === "preflight-failure"
          ? "preflight-failed"
          : caseName === "blocked-result"
            ? "blocked"
            : "completed",
      fingerprint: `sha256:${"9".repeat(64)}`,
      card: { id: "PM-CANARY" },
    },
    ledger:
      caseName === "preflight-failure"
        ? { path: "", sha256: "" }
        : { path: ".pm/loop-runs/run.json", sha256: `sha256:${"8".repeat(64)}` },
    assertions,
    passed: true,
  };
}

test("canary evidence validation rejects empty, false, reversed, and future evidence", () => {
  const empty = completeRecord("verified-pr");
  empty.before = {};
  assert.match(validateEvidenceRecord(empty, "verified-pr"), /before/i);

  const falseAssertion = completeRecord("blocked-result");
  falseAssertion.assertions.card_needs_human = false;
  assert.match(validateEvidenceRecord(falseAssertion, "blocked-result"), /card_needs_human/i);

  const reversed = completeRecord("preflight-failure");
  reversed.ended_at = "2026-07-10T00:59:00.000Z";
  assert.match(validateEvidenceRecord(reversed, "preflight-failure"), /chronological/i);

  const future = completeRecord("verified-pr");
  assert.match(
    validateEvidenceRecord(future, "verified-pr", { now: new Date("2026-07-09T01:00:00.000Z") }),
    /future/i
  );
});

test("canary identity preserves the approved execution hash", () => {
  const config = normalizeLoopConfig({ autonomy: { merge_pr: false } });
  config.execution_config_hash = executionConfigHash(config);
  const actual = currentCanaryIdentity(config, {
    sourceCommit: "a".repeat(40),
    versionRunner: () => "codex 1.0.0\n",
  });
  assert.equal(actual.execution_config_hash, config.execution_config_hash);
});

test("supervised canary cases persist their exact state assertions", async (t) => {
  for (const caseName of ["preflight-failure", "blocked-result", "verified-pr"]) {
    await t.test(caseName, () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-loop-canary-"));
      try {
        const pmDir = path.join(root, "pm");
        const pmStateDir = path.join(root, ".pm");
        fs.mkdirSync(pmDir, { recursive: true });
        fs.mkdirSync(pmStateDir, { recursive: true });
        const runId = `loop-${caseName.replace(/[^a-z]/g, "a")}-12345678`;
        const ledgerPath = path.join(pmStateDir, `${runId}.json`);
        const actualStatus =
          caseName === "preflight-failure"
            ? "preflight-failed"
            : caseName === "blocked-result"
              ? "blocked"
              : "completed";
        if (caseName !== "preflight-failure") {
          fs.writeFileSync(
            ledgerPath,
            JSON.stringify({
              status: actualStatus,
              ...(caseName === "verified-pr"
                ? { artifact_verification: { pr: { ok: true, state: "OPEN" } } }
                : {}),
            })
          );
        }
        const before = state();
        const after =
          caseName === "preflight-failure"
            ? before
            : state({
                status: caseName === "blocked-result" ? "needs-human" : "shipping",
                runId,
                eventStatus: caseName === "blocked-result" ? "blocked" : "completed",
              });
        let calls = 0;
        const record = runCanary(root, caseName, {
          card: caseName === "verified-pr" ? "PM-CANARY" : "",
          paths: { pmDir, pmStateDir },
          config: normalizeLoopConfig({ autonomy: { merge_pr: false } }),
          identity,
          fixtureFactory:
            caseName === "verified-pr"
              ? undefined
              : () => ({
                  projectDir: path.join(root, "fixture-project"),
                  paths: { pmDir, pmStateDir: path.join(root, "fixture-state") },
                  cleanup() {},
                }),
          runWorker(_projectDir, workerOptions) {
            calls += 1;
            if (workerOptions.dryRun) {
              return {
                status: "dry-run",
                selected: { id: "PM-CANARY", stage: "dev", sourcePath: "" },
                fingerprint: `sha256:${"9".repeat(64)}`,
              };
            }
            return {
              status: actualStatus,
              run_id: caseName === "preflight-failure" ? undefined : runId,
              ledger: caseName === "preflight-failure" ? undefined : ledgerPath,
              fingerprint: `sha256:${"9".repeat(64)}`,
              card: { id: "PM-CANARY" },
            };
          },
          snapshot() {
            return calls <= 1 ? before : after;
          },
        });

        assert.equal(record.passed, true, JSON.stringify(record));
        assert.equal(validateEvidenceRecord(record, caseName), "");
        assert.match(record.evidence_path, new RegExp(`\\.pm/loop-canary/.+/${caseName}\\.json$`));
        assert.equal(fs.statSync(record.evidence_path).mode & 0o777, 0o600);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  }
});

test("fixture-only cases never execute against the supplied real project or PM directory", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-loop-canary-isolation-"));
  try {
    const pmDir = path.join(root, "real-pm");
    const pmStateDir = path.join(root, ".pm");
    const fixtureProject = path.join(root, "fixture-project");
    const fixturePmDir = path.join(root, "fixture-pm");
    const fixtureStateDir = path.join(root, "fixture-state");
    for (const dir of [pmDir, pmStateDir, fixtureProject, fixturePmDir, fixtureStateDir]) {
      fs.mkdirSync(dir, { recursive: true });
    }
    let calls = 0;
    const before = state();
    const record = runCanary(root, "preflight-failure", {
      paths: { pmDir, pmStateDir },
      config: normalizeLoopConfig({ autonomy: { merge_pr: false } }),
      identity,
      fixtureFactory() {
        return {
          projectDir: fixtureProject,
          paths: { pmDir: fixturePmDir, pmStateDir: fixtureStateDir },
          cleanup() {},
        };
      },
      runWorker(projectDir, workerOptions) {
        assert.equal(projectDir, fixtureProject);
        assert.equal(workerOptions.pmDir, fixturePmDir);
        calls += 1;
        if (workerOptions.dryRun) {
          return {
            status: "dry-run",
            selected: { id: "PM-CANARY", stage: "dev", sourcePath: "" },
            fingerprint: `sha256:${"9".repeat(64)}`,
          };
        }
        return {
          status: "preflight-failed",
          fingerprint: `sha256:${"9".repeat(64)}`,
          card: { id: "PM-CANARY" },
        };
      },
      snapshot: () => before,
    });
    assert.equal(calls, 2);
    assert.equal(record.passed, true);
    assert.match(record.evidence_path, new RegExp(`${path.basename(pmStateDir)}/loop-canary/`));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("default fixture canaries create disposable Git-backed PM/source state", async (t) => {
  for (const caseName of ["preflight-failure", "blocked-result"]) {
    await t.test(caseName, () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-loop-canary-default-fixture-"));
      try {
        const pmDir = path.join(root, "real-pm");
        const pmStateDir = path.join(root, ".pm");
        const engineBin = path.join(root, "fixture-engine");
        fs.writeFileSync(
          engineBin,
          [
            "#!/usr/bin/env node",
            'const fs = require("node:fs");',
            'if (process.argv.includes("--version")) { console.log("fixture-engine 1.0.0"); process.exit(0); }',
            'if (process.env.PM_LOOP_PREFLIGHT === "1") process.exit(0);',
            'let input = "";',
            'process.stdin.setEncoding("utf8");',
            'process.stdin.on("data", (chunk) => { input += chunk; });',
            'process.stdin.on("end", () => {',
            '  const result = { version: 1, run_id: process.env.PM_LOOP_RUN_ID, card_id: process.env.PM_LOOP_CARD_ID, stage: process.env.PM_LOOP_STAGE, status: "blocked", summary: "Controlled fixture blocked", blocker: { code: "supervised-fixture-blocked", reason: "Controlled fixture blocker", remediation: "Confirm the blocked canary evidence." }, gates: [], usage: { input_tokens: null, output_tokens: null, total_tokens: null } };',
            "  const temp = `${process.env.PM_LOOP_RESULT_FILE}.${process.pid}.tmp`;",
            '  fs.writeFileSync(temp, `${JSON.stringify(result, null, 2)}\\n`, { flag: "wx", mode: 0o600 });',
            "  fs.renameSync(temp, process.env.PM_LOOP_RESULT_FILE);",
            "});",
            "",
          ].join("\n")
        );
        fs.chmodSync(engineBin, 0o755);
        const config = normalizeLoopConfig({
          autonomy: { start_dev: true, merge_pr: false },
          worker: { engine_bin: engineBin, keep_workspace: false },
        });
        fs.mkdirSync(pmDir, { recursive: true });
        fs.mkdirSync(pmStateDir, { recursive: true });
        const record = runCanary(process.cwd(), caseName, {
          paths: { pmDir, pmStateDir },
          config,
          identity: {
            ...identity,
            execution_config_hash: executionConfigHash(config),
            engine: {
              ...identity.engine,
              kind: "custom",
              argv_hash: sha256(JSON.stringify(canonicalEngineArgv(config))),
            },
          },
        });
        assert.equal(record.passed, true, JSON.stringify(record));
        assert.equal(validateEvidenceRecord(record, caseName), "");
        assert.equal(fs.existsSync(path.join(pmDir, "loop")), false);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  }
});

test("verified-pr passes --card through exact selection and execution", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-loop-canary-card-"));
  try {
    const pmDir = path.join(root, "pm");
    const pmStateDir = path.join(root, ".pm");
    fs.mkdirSync(pmDir, { recursive: true });
    fs.mkdirSync(pmStateDir, { recursive: true });
    const runId = "loop-verifiedpr-12345678";
    const ledgerPath = path.join(pmStateDir, `${runId}.json`);
    fs.writeFileSync(
      ledgerPath,
      JSON.stringify({
        status: "completed",
        artifact_verification: { pr: { ok: true, state: "OPEN" } },
      })
    );
    let calls = 0;
    const record = runCanary(root, "verified-pr", {
      card: "PM-CANARY",
      paths: { pmDir, pmStateDir },
      config: normalizeLoopConfig({ autonomy: { merge_pr: false } }),
      identity,
      runWorker(_projectDir, workerOptions) {
        assert.equal(workerOptions.cardId, "PM-CANARY");
        calls += 1;
        if (workerOptions.dryRun) {
          return {
            status: "dry-run",
            selected: { id: "PM-CANARY", stage: "dev", sourcePath: "" },
            fingerprint: `sha256:${"9".repeat(64)}`,
          };
        }
        return {
          status: "completed",
          run_id: runId,
          ledger: ledgerPath,
          fingerprint: `sha256:${"9".repeat(64)}`,
          card: { id: "PM-CANARY" },
        };
      },
      snapshot(_pmDir, _cardId, _relativePath, options) {
        return calls <= 1
          ? state()
          : state({ status: "shipping", runId: options?.runId || runId, eventStatus: "completed" });
      },
    });
    assert.equal(calls, 2);
    assert.equal(record.passed, true, JSON.stringify(record));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
