"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const {
  attestPrBody,
  beginEffect,
  createReleaseTransaction,
  planEffect,
  reconcileEffect,
} = require("../scripts/lib/release-transaction-schema");
const { stableStringify } = require("../scripts/lib/workflow-runtime/records");
const script = path.resolve(__dirname, "../scripts/release-transaction.js");
const COMMIT = "a".repeat(40);
const PR_BODY = "## Summary\n\nCanonical reviewer handoff.\n";
const PR_BODY_SHA256 = `sha256:${crypto.createHash("sha256").update(PR_BODY).digest("hex")}`;

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-release-cli-"));
  const sessionDir = path.join(root, ".pm/dev-sessions/example");
  fs.mkdirSync(path.join(sessionDir, "ship"), { recursive: true });
  const transactionPath = path.join(sessionDir, "ship/release-transaction.json");
  fs.writeFileSync(path.join(sessionDir, "ship/pr-body.md"), PR_BODY);
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

function runWithEnvironment(root, environment, ...args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...environment },
  });
}

function writePrBodyRacePreload(root) {
  const preloadPath = path.join(root, "pr-body-race-preload.cjs");
  fs.writeFileSync(
    preloadPath,
    `"use strict";
const fs = require("node:fs");
const path = require("node:path");
const target = fs.realpathSync(path.resolve(process.env.PM_TEST_PR_BODY_PATH));
const action = process.env.PM_TEST_PR_BODY_ACTION;
const originalOpen = fs.openSync;
const originalRead = fs.readSync;
let targetDescriptor;
let mutated = false;
fs.openSync = function patchedOpen(file, ...args) {
  const descriptor = Reflect.apply(originalOpen, fs, [file, ...args]);
  if (targetDescriptor === undefined && path.resolve(String(file)) === target) {
    targetDescriptor = descriptor;
  }
  return descriptor;
};
fs.readSync = function patchedRead(descriptor, ...args) {
  if (!mutated && descriptor === targetDescriptor) {
    mutated = true;
    if (action === "replace") {
      fs.renameSync(target, target + ".opened");
      fs.writeFileSync(target, "replacement body\\n");
    } else if (action === "grow") {
      fs.appendFileSync(target, Buffer.alloc(256 * 1024, "x"));
    }
  }
  return Reflect.apply(originalRead, fs, [descriptor, ...args]);
};
`
  );
  return preloadPath;
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
      body_sha256: PR_BODY_SHA256,
    },
  });
  value = beginEffect(value, {
    effect: "create-pr",
    authority: { create_pr: true },
    actor: "root",
  }).transaction;
  const receipt = {
    pr_number: 7,
    state: "OPEN",
    head_oid: COMMIT,
    draft: false,
    body_sha256: PR_BODY_SHA256,
  };
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

function asLegacyPrBody(value) {
  value = structuredClone(value);
  const effect = value.effects["create-pr"];
  delete effect.target.body_sha256;
  for (const attempt of effect.attempts) {
    if (attempt.receipt) delete attempt.receipt.body_sha256;
    if (attempt.observation?.target) delete attempt.observation.target.body_sha256;
    if (attempt.observation?.receipt) delete attempt.observation.receipt.body_sha256;
  }
  if (effect.verified_receipt) {
    delete effect.verified_receipt.target.body_sha256;
    delete effect.verified_receipt.receipt.body_sha256;
    delete effect.verified_receipt.verification.target.body_sha256;
    delete effect.verified_receipt.verification.receipt.body_sha256;
  }
  delete value.pr_body_attestation;
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
  const merge = value.effects.merge;
  if (merge) {
    delete merge.target.body_sha256;
    for (const attempt of merge.attempts) {
      if (attempt.receipt) delete attempt.receipt.body_sha256;
      if (attempt.observation?.target) delete attempt.observation.target.body_sha256;
      if (attempt.observation?.receipt) delete attempt.observation.receipt.body_sha256;
    }
    if (merge.verified_receipt) {
      delete merge.verified_receipt.target.body_sha256;
      delete merge.verified_receipt.receipt.body_sha256;
      delete merge.verified_receipt.verification.target.body_sha256;
      delete merge.verified_receipt.verification.receipt.body_sha256;
    }
    merge.idempotency_key = `sha256:${crypto
      .createHash("sha256")
      .update(
        stableStringify({
          run_id: value.run_id,
          prepared_commit: value.release.prepared_commit,
          effect: "merge",
          target: merge.target,
        })
      )
      .digest("hex")}`;
  }
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

test("CLI plans create-pr only when body_sha256 matches canonical pr-body.md", () => {
  const item = fixture();
  try {
    const targetPath = ".pm/dev-sessions/example/ship/create-pr-target.json";
    const target = {
      repository: "acme/widget",
      head: "codex/example",
      base: "main",
      commit: COMMIT,
      draft: false,
      body_sha256: PR_BODY_SHA256,
    };
    fs.writeFileSync(path.join(item.root, targetPath), `${JSON.stringify(target)}\n`);
    const planned = run(
      item.root,
      "plan",
      "--transaction",
      item.transactionPath,
      "--effect",
      "create-pr",
      "--target-file",
      targetPath,
      "--json"
    );
    assert.equal(planned.status, 0, planned.stderr);

    const next = fixture();
    try {
      target.body_sha256 = `sha256:${"0".repeat(64)}`;
      fs.writeFileSync(path.join(next.root, targetPath), `${JSON.stringify(target)}\n`);
      const rejected = run(
        next.root,
        "plan",
        "--transaction",
        next.transactionPath,
        "--effect",
        "create-pr",
        "--target-file",
        targetPath,
        "--json"
      );
      assert.notEqual(rejected.status, 0);
      assert.match(rejected.stderr, /does not match canonical pr-body\.md bytes/);
    } finally {
      next.cleanup();
    }
  } finally {
    item.cleanup();
  }
});

test("CLI bounds the complete PR-body observation before parsing", () => {
  const item = fixture();
  try {
    const transactionFile = path.join(item.root, item.transactionPath);
    const original = JSON.parse(fs.readFileSync(transactionFile, "utf8"));
    fs.writeFileSync(
      transactionFile,
      `${JSON.stringify(legacyVerifiedCreatePr(original, false), null, 2)}\n`
    );
    const observationPath = ".pm/dev-sessions/example/ship/observations/pr-body-large.json";
    fs.mkdirSync(path.dirname(path.join(item.root, observationPath)), { recursive: true });
    fs.writeFileSync(
      path.join(item.root, observationPath),
      `${JSON.stringify({
        repository: "x".repeat(1024 * 1024),
        pr_number: 7,
        state: "OPEN",
        head_oid: COMMIT,
        base: "main",
        draft: false,
        body: PR_BODY,
        observed_at: new Date().toISOString(),
      })}\n`
    );
    const before = fs.readFileSync(transactionFile, "utf8");

    const result = run(
      item.root,
      "attest-pr-body",
      "--transaction",
      item.transactionPath,
      "--observation-file",
      observationPath,
      "--json"
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /input exceeds 1048576-byte budget/);
    assert.equal(fs.readFileSync(transactionFile, "utf8"), before);
  } finally {
    item.cleanup();
  }
});

for (const scenario of ["replace", "symlink", "grow"]) {
  test(`CLI rejects a canonical PR-body ${scenario} without changing the transaction`, (t) => {
    if (scenario === "symlink" && process.platform === "win32") {
      return t.skip("file symlink setup requires privileges");
    }
    const item = fixture();
    try {
      const transactionFile = path.join(item.root, item.transactionPath);
      const bodyPath = path.join(item.root, ".pm/dev-sessions/example/ship/pr-body.md");
      const targetPath = ".pm/dev-sessions/example/ship/create-pr-target.json";
      fs.writeFileSync(
        path.join(item.root, targetPath),
        `${JSON.stringify({
          repository: "acme/widget",
          head: "codex/example",
          base: "main",
          commit: COMMIT,
          draft: false,
          body_sha256: PR_BODY_SHA256,
        })}\n`
      );
      const before = fs.readFileSync(transactionFile, "utf8");
      let result;
      if (scenario === "symlink") {
        const target = `${bodyPath}.target`;
        fs.renameSync(bodyPath, target);
        fs.symlinkSync(target, bodyPath);
        result = run(
          item.root,
          "plan",
          "--transaction",
          item.transactionPath,
          "--effect",
          "create-pr",
          "--target-file",
          targetPath,
          "--json"
        );
      } else {
        const preloadPath = writePrBodyRacePreload(item.root);
        const nodeOptions = [process.env.NODE_OPTIONS, `--require=${preloadPath}`]
          .filter(Boolean)
          .join(" ");
        result = runWithEnvironment(
          item.root,
          {
            NODE_OPTIONS: nodeOptions,
            PM_TEST_PR_BODY_ACTION: scenario,
            PM_TEST_PR_BODY_PATH: bodyPath,
          },
          "plan",
          "--transaction",
          item.transactionPath,
          "--effect",
          "create-pr",
          "--target-file",
          targetPath,
          "--json"
        );
      }

      assert.notEqual(result.status, 0);
      assert.match(
        result.stderr,
        /canonical pr-body\.md is unavailable:.*(?:symlink|changed during bounded read|input path changed|input exceeds 131072-byte budget)/s
      );
      assert.equal(fs.readFileSync(transactionFile, "utf8"), before);
    } finally {
      item.cleanup();
    }
  });
}

test("CLI gives legacy journals an explicit body rebind and re-observation path", () => {
  const item = fixture();
  try {
    const file = path.join(item.root, item.transactionPath);
    const original = JSON.parse(fs.readFileSync(file, "utf8"));
    fs.writeFileSync(
      file,
      `${JSON.stringify(asLegacyPrBody(legacyVerifiedCreatePr(original, false)), null, 2)}\n`
    );
    const before = run(item.root, "status", "--transaction", item.transactionPath, "--json");
    assert.equal(before.status, 0, before.stderr);
    assert.equal(JSON.parse(before.stdout).migration_pending, true);
    assert.match(JSON.parse(before.stdout).readiness_issues.join("; "), /migrate-pr-body/);

    const migrated = run(
      item.root,
      "migrate-pr-body",
      "--transaction",
      item.transactionPath,
      "--json"
    );
    assert.equal(migrated.status, 0, migrated.stderr);
    let saved = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(saved.effects["create-pr"].target.body_sha256, PR_BODY_SHA256);
    assert.equal(saved.effects["create-pr"].status, "attempting");

    const receipt = {
      pr_number: 7,
      state: "OPEN",
      head_oid: COMMIT,
      draft: false,
      body_sha256: PR_BODY_SHA256,
    };
    const receiptPath = ".pm/dev-sessions/example/ship/receipts/create-pr.json";
    const observationPath = ".pm/dev-sessions/example/ship/observations/create-pr.json";
    fs.mkdirSync(path.dirname(path.join(item.root, receiptPath)), { recursive: true });
    fs.mkdirSync(path.dirname(path.join(item.root, observationPath)), { recursive: true });
    fs.writeFileSync(path.join(item.root, receiptPath), `${JSON.stringify(receipt)}\n`);
    fs.writeFileSync(
      path.join(item.root, observationPath),
      `${JSON.stringify({ target: saved.effects["create-pr"].target, receipt })}\n`
    );
    const reconciled = run(
      item.root,
      "reconcile",
      "--transaction",
      item.transactionPath,
      "--effect",
      "create-pr",
      "--outcome",
      "matched",
      "--observation-file",
      observationPath,
      "--receipt-file",
      receiptPath,
      "--json"
    );
    assert.equal(reconciled.status, 0, reconciled.stderr);
    saved = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(saved.effects["create-pr"].status, "verified");
    assert.equal(saved.effects["create-pr"].verified_receipt.receipt.body_sha256, PR_BODY_SHA256);
  } finally {
    item.cleanup();
  }
});

test("CLI rejects stale PR-body observations and consumes a fresh observation once", () => {
  const item = fixture();
  try {
    const file = path.join(item.root, item.transactionPath);
    const original = JSON.parse(fs.readFileSync(file, "utf8"));
    fs.writeFileSync(file, `${JSON.stringify(legacyVerifiedCreatePr(original, false), null, 2)}\n`);
    fs.writeFileSync(
      path.join(item.root, item.sessionPath),
      `${JSON.stringify({ run_id: "dev_release_cli", authority: { merge: true } })}\n`
    );
    const targetPath = ".pm/dev-sessions/example/ship/merge-target.json";
    const target = {
      repository: "acme/widget",
      pr_number: 7,
      head_commit: COMMIT,
      base: "main",
      method: "squash",
      body_sha256: PR_BODY_SHA256,
    };
    fs.writeFileSync(path.join(item.root, targetPath), `${JSON.stringify(target)}\n`);
    const planned = run(
      item.root,
      "plan",
      "--transaction",
      item.transactionPath,
      "--effect",
      "merge",
      "--target-file",
      targetPath,
      "--json"
    );
    assert.equal(planned.status, 0, planned.stderr);

    const observationPath = ".pm/dev-sessions/example/ship/observations/pr-body.json";
    fs.mkdirSync(path.dirname(path.join(item.root, observationPath)), { recursive: true });
    const observation = {
      repository: "acme/widget",
      pr_number: 7,
      state: "OPEN",
      head_oid: COMMIT,
      base: "main",
      draft: false,
      body: PR_BODY,
      observed_at: "2000-01-01T00:00:00.000Z",
    };
    fs.writeFileSync(path.join(item.root, observationPath), `${JSON.stringify(observation)}\n`);
    const transactionBeforeStaleAttestation = fs.readFileSync(file, "utf8");
    const staleAttestation = run(
      item.root,
      "attest-pr-body",
      "--transaction",
      item.transactionPath,
      "--observation-file",
      observationPath,
      "--json"
    );
    assert.notEqual(staleAttestation.status, 0);
    assert.match(staleAttestation.stderr, /last 5 minutes/);
    assert.equal(fs.readFileSync(file, "utf8"), transactionBeforeStaleAttestation);
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).pr_body_attestation, null);

    observation.observed_at = new Date().toISOString();
    fs.writeFileSync(path.join(item.root, observationPath), `${JSON.stringify(observation)}\n`);
    const attested = run(
      item.root,
      "attest-pr-body",
      "--transaction",
      item.transactionPath,
      "--observation-file",
      observationPath,
      "--json"
    );
    assert.equal(attested.status, 0, attested.stderr);
    assert.equal(JSON.parse(attested.stdout).decision, "pr-body-attested");

    const begun = run(
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
    assert.equal(begun.status, 0, begun.stderr);
    assert.equal(JSON.parse(begun.stdout).decision, "execute");
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(saved.pr_body_attestation.body_sha256, PR_BODY_SHA256);
    assert.equal(saved.pr_body_attestation.observed_at, observation.observed_at);
    assert.equal(saved.pr_body_attestation.consumed_by_attempt, 1);

    const absentObservationPath = ".pm/dev-sessions/example/ship/observations/merge-absent.json";
    fs.writeFileSync(
      path.join(item.root, absentObservationPath),
      `${JSON.stringify({ state: "OPEN" })}\n`
    );
    const retrySafe = run(
      item.root,
      "reconcile",
      "--transaction",
      item.transactionPath,
      "--effect",
      "merge",
      "--outcome",
      "absent",
      "--observation-file",
      absentObservationPath,
      "--json"
    );
    assert.equal(retrySafe.status, 0, retrySafe.stderr);
    assert.equal(JSON.parse(retrySafe.stdout).decision, "retry-safe");
    const reused = run(
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
    assert.notEqual(reused.status, 0);
    assert.match(reused.stderr, /new one-use PR body attestation/);
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
      body_sha256: PR_BODY_SHA256,
    };
    value = planEffect(value, { effect: "merge", target: mergeTarget });
    value = attestPrBody(value, {
      timestamp: "2026-07-14T00:00:01.000Z",
      observation: {
        repository: "acme/widget",
        pr_number: 7,
        state: "OPEN",
        head_oid: COMMIT,
        base: "main",
        draft: false,
        body: PR_BODY,
        observed_at: "2026-07-14T00:00:00.000Z",
      },
    });
    value = beginEffect(value, {
      effect: "merge",
      authority: { merge: true },
      actor: "root",
      timestamp: "2026-07-14T00:00:02.000Z",
    }).transaction;
    const mergeReceipt = {
      pr_number: 7,
      state: "MERGED",
      head_oid: COMMIT,
      merge_sha: "d".repeat(40),
      body_sha256: PR_BODY_SHA256,
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
    const legacy = asLegacyPrBody(asLegacyCreatePr(value));
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
        body_sha256: PR_BODY_SHA256,
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
