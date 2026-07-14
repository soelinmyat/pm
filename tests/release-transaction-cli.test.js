"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { createReleaseTransaction } = require("../scripts/lib/release-transaction-schema");
const script = path.resolve(__dirname, "../scripts/release-transaction.js");
const COMMIT = "a".repeat(40);

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-release-cli-"));
  const sessionDir = path.join(root, ".pm/dev-sessions/example");
  fs.mkdirSync(path.join(sessionDir, "ship"), { recursive: true });
  const transactionPath = path.join(sessionDir, "ship/release-transaction.json");
  fs.writeFileSync(
    transactionPath,
    `${JSON.stringify(
      createReleaseTransaction({
        runId: "dev_release_cli",
        slug: "example",
        repository: "acme/widget",
        deliveryRemote: "origin",
        headBranch: "codex/example",
        baseBranch: "main",
        pushUrlSha256: `sha256:${"b".repeat(64)}`,
        currentVersion: "1.0.0",
        nextVersion: "1.0.1",
        preparedCommit: COMMIT,
        manifestHashes: [{ path: "plugin.config.json", sha256: `sha256:${"c".repeat(64)}` }],
      }),
      null,
      2
    )}\n`
  );
  const sessionPath = path.join(sessionDir, "session.json");
  fs.writeFileSync(
    sessionPath,
    `${JSON.stringify({
      run_id: "dev_release_cli",
      authority: { push_feature_branch: false },
    })}\n`
  );
  return {
    root,
    transactionPath: path.relative(root, transactionPath),
    sessionPath: path.relative(root, sessionPath),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

function run(root, ...args) {
  return spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: "utf8" });
}

test("CLI validates, plans, and durably records authority denial", () => {
  const item = fixture();
  try {
    const valid = run(item.root, "validate", "--transaction", item.transactionPath, "--json");
    assert.equal(valid.status, 0, valid.stderr);
    assert.equal(JSON.parse(valid.stdout).ok, true);

    const target = ".pm/dev-sessions/example/ship/push-target.json";
    fs.writeFileSync(
      path.join(item.root, target),
      `${JSON.stringify({ remote: "origin", branch: "codex/example", commit: COMMIT })}\n`
    );
    const planned = run(
      item.root,
      "plan",
      "--transaction",
      item.transactionPath,
      "--effect",
      "push",
      "--target-file",
      target,
      "--json"
    );
    assert.equal(planned.status, 0, planned.stderr);
    assert.equal(JSON.parse(planned.stdout).decision, "planned");

    const denied = run(
      item.root,
      "begin",
      "--transaction",
      item.transactionPath,
      "--effect",
      "push",
      "--session",
      item.sessionPath,
      "--actor",
      "root",
      "--json"
    );
    assert.equal(denied.status, 0, denied.stderr);
    assert.equal(JSON.parse(denied.stdout).decision, "denied");
    const saved = JSON.parse(fs.readFileSync(path.join(item.root, item.transactionPath), "utf8"));
    assert.equal(saved.effects.push.attempts[0].classification, "authority");
  } finally {
    item.cleanup();
  }
});

test("CLI refuses transaction and session paths outside private state", () => {
  const item = fixture();
  try {
    const result = run(item.root, "validate", "--transaction", "transaction.json");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /beneath \.pm/);
  } finally {
    item.cleanup();
  }
});
