"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const {
  beginEffect,
  createReleaseTransaction,
  planEffect,
  reconcileEffect,
} = require("../scripts/lib/release-transaction-schema");
const { stableStringify } = require("../scripts/lib/workflow-runtime/records");
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

function legacyVerifiedCreatePr(transaction, legacy = true) {
  let value = planEffect(transaction, {
    effect: "push",
    target: {
      remote: "origin",
      repository: "acme/widget",
      branch: "codex/example",
      commit: COMMIT,
    },
  });
  value = beginEffect(value, {
    effect: "push",
    authority: { push_feature_branch: true },
    actor: "root",
  }).transaction;
  value = reconcileEffect(value, {
    effect: "push",
    outcome: "matched",
    receipt: { remote_tip: COMMIT },
    observation: { target: value.effects.push.target, receipt: { remote_tip: COMMIT } },
  }).transaction;
  value = planEffect(value, {
    effect: "create-pr",
    target: {
      repository: "acme/widget",
      head: "codex/example",
      base: "main",
      commit: COMMIT,
      draft: false,
    },
  });
  value = beginEffect(value, {
    effect: "create-pr",
    authority: { create_pr: true },
    actor: "root",
  }).transaction;
  const receipt = { pr_number: 7, state: "OPEN", head_oid: COMMIT, draft: false };
  value = reconcileEffect(value, {
    effect: "create-pr",
    outcome: "matched",
    receipt,
    observation: { target: value.effects["create-pr"].target, receipt },
  }).transaction;
  return legacy ? asLegacyCreatePr(value) : value;
}

function asLegacyCreatePr(value) {
  value = structuredClone(value);
  const effect = value.effects["create-pr"];
  delete effect.target.draft;
  delete effect.attempts.at(-1).receipt.draft;
  delete effect.attempts.at(-1).observation.target.draft;
  delete effect.attempts.at(-1).observation.receipt.draft;
  delete effect.verified_receipt.target.draft;
  delete effect.verified_receipt.receipt.draft;
  delete effect.verified_receipt.verification.target.draft;
  delete effect.verified_receipt.verification.receipt.draft;
  effect.idempotency_key = `sha256:${crypto
    .createHash("sha256")
    .update(
      stableStringify({
        run_id: value.run_id,
        prepared_commit: value.release.prepared_commit,
        effect: "create-pr",
        target: effect.target,
      })
    )
    .digest("hex")}`;
  return value;
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
      `${JSON.stringify({
        remote: "origin",
        repository: "acme/widget",
        branch: "codex/example",
        commit: COMMIT,
      })}\n`
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

test("read-only CLI commands persist legacy PR migration before reporting status", () => {
  const item = fixture();
  try {
    const file = path.join(item.root, item.transactionPath);
    const legacy = legacyVerifiedCreatePr(JSON.parse(fs.readFileSync(file, "utf8")));
    fs.writeFileSync(file, `${JSON.stringify(legacy, null, 2)}\n`);
    const status = run(item.root, "status", "--transaction", item.transactionPath, "--json");
    assert.equal(status.status, 0, status.stderr);
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(saved.effects["create-pr"].status, "attempting");
    assert.equal(saved.effects["create-pr"].target.draft, false);
    assert.equal(saved.effects["create-pr"].verified_receipt, null);
  } finally {
    item.cleanup();
  }
});

test("completed legacy delivery stays byte-stable across status and validate", () => {
  const item = fixture();
  try {
    const file = path.join(item.root, item.transactionPath);
    let value = legacyVerifiedCreatePr(JSON.parse(fs.readFileSync(file, "utf8")), false);
    const mergeTarget = {
      repository: "acme/widget",
      pr_number: 7,
      head_commit: COMMIT,
      base: "main",
      method: "squash",
    };
    value = planEffect(value, { effect: "merge", target: mergeTarget });
    value = beginEffect(value, {
      effect: "merge",
      authority: { merge: true },
      actor: "root",
    }).transaction;
    const mergeReceipt = {
      pr_number: 7,
      state: "MERGED",
      head_oid: COMMIT,
      merge_sha: "d".repeat(40),
    };
    value = reconcileEffect(value, {
      effect: "merge",
      outcome: "matched",
      receipt: mergeReceipt,
      observation: { target: mergeTarget, receipt: mergeReceipt },
    }).transaction;
    const tagTarget = {
      remote: "origin",
      tag: "v1.0.1",
      merge_sha: mergeReceipt.merge_sha,
      base: "main",
    };
    value = planEffect(value, { effect: "place-main-tag", target: tagTarget });
    value = beginEffect(value, {
      effect: "place-main-tag",
      authority: { merge: true },
      actor: "root",
    }).transaction;
    value = reconcileEffect(value, {
      effect: "place-main-tag",
      outcome: "matched",
      receipt: { tag: "v1.0.1", peeled_sha: mergeReceipt.merge_sha },
      observation: {
        target: tagTarget,
        receipt: { tag: "v1.0.1", peeled_sha: mergeReceipt.merge_sha },
      },
    }).transaction;
    const legacy = asLegacyCreatePr(value);
    const before = `${JSON.stringify(legacy, null, 2)}\n`;
    fs.writeFileSync(file, before);
    for (const command of ["status", "validate"]) {
      const result = run(item.root, command, "--transaction", item.transactionPath, "--json");
      assert.equal(result.status, 0, result.stderr);
      assert.equal(fs.readFileSync(file, "utf8"), before);
    }
  } finally {
    item.cleanup();
  }
});

test("a failing begin persists planned-Merge legacy normalization", () => {
  const item = fixture();
  try {
    const file = path.join(item.root, item.transactionPath);
    let value = legacyVerifiedCreatePr(JSON.parse(fs.readFileSync(file, "utf8")), false);
    value = planEffect(value, {
      effect: "merge",
      target: {
        repository: "acme/widget",
        pr_number: 7,
        head_commit: COMMIT,
        base: "main",
        method: "squash",
      },
    });
    value = asLegacyCreatePr(value);
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
    const result = run(
      item.root,
      "begin",
      "--transaction",
      item.transactionPath,
      "--effect",
      "merge",
      "--session",
      item.sessionPath,
      "--actor",
      "root",
      "--json"
    );
    assert.notEqual(result.status, 0);
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(saved.effects.merge, undefined);
    assert.equal(saved.effects["create-pr"].status, "attempting");
    assert.equal(saved.effects["create-pr"].target.draft, false);
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

test("CLI initializes a delivery-only transaction for repositories without version mutation", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-release-init-"));
  try {
    const git = (...args) => {
      const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };
    git("init", "-q");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test User");
    fs.writeFileSync(path.join(root, "README.md"), "delivery\n");
    git("add", "README.md");
    git("commit", "-q", "-m", "delivery");
    git("branch", "-M", "codex/example");
    git("remote", "add", "origin", "https://github.com/acme/widget.git");
    const sessionDir = path.join(root, ".pm/dev-sessions/example");
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(
      path.join(sessionDir, "session.json"),
      `${JSON.stringify({
        run_id: "dev_delivery_cli",
        slug: "example",
        source: {
          branch: "codex/example",
          default_branch: "main",
          delivery_remote: "origin",
        },
      })}\n`
    );
    const result = run(
      root,
      "initialize",
      "--transaction",
      ".pm/dev-sessions/example/ship/release-transaction.json",
      "--session",
      ".pm/dev-sessions/example/session.json",
      "--json"
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).decision, "initialized");
    const transaction = JSON.parse(
      fs.readFileSync(path.join(sessionDir, "ship/release-transaction.json"), "utf8")
    );
    assert.equal(transaction.release.mode, "delivery-only");
    assert.equal(transaction.release.tag, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
