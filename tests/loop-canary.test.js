"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { runCanary, validateEvidenceRecord } = require("../scripts/loop-canary.js");
const { normalizeLoopConfig } = require("../scripts/loop-config.js");

const identity = {
  plugin_version: "1.13.6",
  source_commit: "a".repeat(40),
  execution_config_hash: `sha256:${"b".repeat(64)}`,
  engine: {
    kind: "codex",
    binary_version: "codex 1.0.0",
    argv_hash: `sha256:${"c".repeat(64)}`,
  },
};

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
    leases: [],
    recovery: [],
    events:
      runId && eventStatus
        ? [
            {
              path: `pm/loop/events/${runId}.json`,
              sha256: `sha256:${"f".repeat(64)}`,
              value: { run_id: runId, status: eventStatus, terminal: true },
            },
          ]
        : [],
  };
}

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
