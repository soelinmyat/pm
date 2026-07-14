"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  bindReleaseEvidence,
  beginEffect,
  createReleaseTransaction,
  advancePreparedCommit,
  planEffect,
  reconcileEffect,
  releaseReadiness,
  transactionIssues,
} = require("../scripts/lib/release-transaction-schema");

const COMMIT = "a".repeat(40);
const MERGE = "b".repeat(40);

function transaction() {
  return createReleaseTransaction({
    runId: "dev_release_1",
    slug: "release-example",
    repository: "acme/widget",
    deliveryRemote: "origin",
    headBranch: "codex/release-example",
    baseBranch: "main",
    pushUrlSha256: `sha256:${"c".repeat(64)}`,
    currentVersion: "1.2.3",
    nextVersion: "1.2.4",
    preparedCommit: COMMIT,
    manifestHashes: [{ path: "plugin.config.json", sha256: `sha256:${"d".repeat(64)}` }],
    timestamp: "2026-07-14T00:00:00.000Z",
  });
}

test("release transaction binds a tagless prepared commit before final evidence", () => {
  const value = transaction();
  assert.equal(value.release.tag, "v1.2.4");
  assert.equal(value.release.prepared_commit, COMMIT);
  assert.equal(value.release.tag_created, false);
  assert.deepEqual(value.evidence, { review: null, qa: null, verification: null });
  assert.deepEqual(transactionIssues(value), []);
});

test("delivery-only transactions keep the same effect journal without inventing a tag", () => {
  const value = createReleaseTransaction({
    releaseMode: "delivery-only",
    runId: "dev_delivery_1",
    slug: "feature",
    repository: "acme/widget",
    deliveryRemote: "origin",
    headBranch: "codex/feature",
    baseBranch: "main",
    pushUrlSha256: `sha256:${"c".repeat(64)}`,
    preparedCommit: COMMIT,
    manifestHashes: [],
  });
  assert.equal(value.release.mode, "delivery-only");
  assert.equal(value.release.tag, null);
  assert.throws(
    () =>
      planEffect(value, {
        effect: "place-main-tag",
        target: { remote: "origin", tag: "v1.0.0", merge_sha: MERGE, base: "main" },
      }),
    /cannot place a release tag/
  );
});

test("effects are dependency ordered and root-owned", () => {
  let value = transaction();
  value = planEffect(value, {
    effect: "create-pr",
    target: {
      repository: "acme/widget",
      head: "codex/release-example",
      base: "main",
      commit: COMMIT,
    },
    timestamp: "2026-07-14T00:01:00.000Z",
  });
  assert.throws(
    () =>
      beginEffect(value, {
        effect: "create-pr",
        authority: { create_pr: true },
        actor: "root",
        timestamp: "2026-07-14T00:02:00.000Z",
      }),
    /requires verified effect push/
  );
  assert.throws(
    () =>
      beginEffect(value, {
        effect: "create-pr",
        authority: { create_pr: true },
        actor: "worker",
      }),
    /root-owned/
  );
});

test("missing authority is a durable denial, not an environment failure", () => {
  let value = planEffect(transaction(), {
    effect: "push",
    target: {
      remote: "origin",
      repository: "acme/widget",
      branch: "codex/release-example",
      commit: COMMIT,
    },
    timestamp: "2026-07-14T00:01:00.000Z",
  });
  const result = beginEffect(value, {
    effect: "push",
    authority: { push_feature_branch: false },
    actor: "root",
    timestamp: "2026-07-14T00:02:00.000Z",
  });
  value = result.transaction;
  assert.equal(result.decision, "denied");
  assert.equal(value.effects.push.status, "denied");
  assert.equal(value.effects.push.attempts[0].classification, "authority");
  assert.equal(value.effects.push.attempts[0].error, "missing authority push_feature_branch");
});

test("ambiguous outcome observes before retry and verified effects never replay", () => {
  let value = planEffect(transaction(), {
    effect: "push",
    target: {
      remote: "origin",
      repository: "acme/widget",
      branch: "codex/release-example",
      commit: COMMIT,
    },
    timestamp: "2026-07-14T00:01:00.000Z",
  });
  let begun = beginEffect(value, {
    effect: "push",
    authority: { push_feature_branch: true },
    actor: "root",
    timestamp: "2026-07-14T00:02:00.000Z",
  });
  value = begun.transaction;
  assert.equal(begun.decision, "execute");
  const resumed = beginEffect(value, {
    effect: "push",
    authority: { push_feature_branch: true },
    actor: "root",
  });
  assert.equal(resumed.decision, "observe-first");
  assert.equal(resumed.transaction.effects.push.attempts.length, 1);

  const safe = reconcileEffect(value, {
    effect: "push",
    outcome: "absent",
    observation: { remote_tip: null },
    timestamp: "2026-07-14T00:03:00.000Z",
  });
  assert.equal(safe.decision, "retry-safe");
  value = safe.transaction;
  assert.equal(value.effects.push.status, "planned");

  begun = beginEffect(value, {
    effect: "push",
    authority: { push_feature_branch: true },
    actor: "root",
    timestamp: "2026-07-14T00:04:00.000Z",
  });
  value = begun.transaction;
  assert.equal(value.effects.push.attempts.length, 2);
  const receipt = { remote_tip: COMMIT };
  const verified = reconcileEffect(value, {
    effect: "push",
    outcome: "matched",
    receipt,
    observation: { target: value.effects.push.target, receipt },
    timestamp: "2026-07-14T00:05:00.000Z",
  });
  assert.equal(verified.decision, "verified");
  value = verified.transaction;
  assert.equal(value.effects.push.status, "verified");
  const noReplay = beginEffect(value, {
    effect: "push",
    authority: { push_feature_branch: true },
    actor: "root",
  });
  assert.equal(noReplay.decision, "already-verified");
  assert.equal(noReplay.transaction.effects.push.attempts.length, 2);
});

test("conflicting observation blocks instead of replaying", () => {
  let value = planEffect(transaction(), {
    effect: "push",
    target: {
      remote: "origin",
      repository: "acme/widget",
      branch: "codex/release-example",
      commit: COMMIT,
    },
  });
  value = beginEffect(value, {
    effect: "push",
    authority: { push_feature_branch: true },
    actor: "root",
  }).transaction;
  const result = reconcileEffect(value, {
    effect: "push",
    outcome: "conflict",
    observation: { remote_tip: "e".repeat(40) },
    reason: "remote branch points to a different commit",
  });
  assert.equal(result.decision, "blocked");
  assert.equal(result.transaction.effects.push.status, "blocked");
});

test("post-preparation commits preserve the old journal and invalidate current evidence", () => {
  let value = planEffect(transaction(), {
    effect: "push",
    target: {
      remote: "origin",
      repository: "acme/widget",
      branch: "codex/release-example",
      commit: COMMIT,
    },
  });
  value = beginEffect(value, {
    effect: "push",
    authority: { push_feature_branch: true },
    actor: "root",
  }).transaction;
  const receipt = { remote_tip: COMMIT };
  value = reconcileEffect(value, {
    effect: "push",
    outcome: "matched",
    receipt,
    observation: { target: value.effects.push.target, receipt },
  }).transaction;
  const nextCommit = "e".repeat(40);
  value = advancePreparedCommit(value, {
    commit: nextCommit,
    reason: "CI fix",
    timestamp: "2026-07-14T00:20:00.000Z",
  });
  assert.equal(value.generation, 2);
  assert.equal(value.release.prepared_commit, nextCommit);
  assert.equal(value.history[0].effects.push.status, "verified");
  assert.deepEqual(value.effects, {});
  assert.deepEqual(value.evidence, { review: null, qa: null, verification: null });
});

test("main tag cannot begin until merge is verified and conflicts never force move", () => {
  assert.throws(
    () =>
      planEffect(transaction(), {
        effect: "place-main-tag",
        target: { remote: "origin", tag: "v1.2.4", merge_sha: MERGE, base: "main" },
      }),
    /verified merge SHA/
  );
});

test("matched observations must prove the planned effect identity", () => {
  let value = planEffect(transaction(), {
    effect: "push",
    target: {
      remote: "origin",
      repository: "acme/widget",
      branch: "codex/release-example",
      commit: COMMIT,
    },
  });
  value = beginEffect(value, {
    effect: "push",
    authority: { push_feature_branch: true },
    actor: "root",
  }).transaction;
  const receipt = { remote_tip: "e".repeat(40) };
  assert.throws(
    () =>
      reconcileEffect(value, {
        effect: "push",
        outcome: "matched",
        receipt,
        observation: { target: value.effects.push.target, receipt },
      }),
    /remote_tip receipt must equal prepared commit/
  );
});

test("effect targets are bound to the release transaction identity", () => {
  assert.throws(
    () =>
      planEffect(transaction(), {
        effect: "push",
        target: {
          remote: "upstream",
          repository: "acme/widget",
          branch: "codex/release-example",
          commit: COMMIT,
        },
      }),
    /remote target must equal delivery remote/
  );
  assert.throws(
    () =>
      planEffect(transaction(), {
        effect: "create-pr",
        target: {
          repository: "other/repo",
          head: "codex/release-example",
          base: "main",
          commit: COMMIT,
        },
      }),
    /repository target must equal repository/
  );
});

test("persisted transactions revalidate target, key, and verified receipt identity", () => {
  let value = planEffect(transaction(), {
    effect: "push",
    target: {
      remote: "origin",
      repository: "acme/widget",
      branch: "codex/release-example",
      commit: COMMIT,
    },
  });
  value = beginEffect(value, {
    effect: "push",
    authority: { push_feature_branch: true },
    actor: "root",
  }).transaction;
  const receipt = { remote_tip: COMMIT };
  value = reconcileEffect(value, {
    effect: "push",
    outcome: "matched",
    receipt,
    observation: { target: value.effects.push.target, receipt },
  }).transaction;
  assert.deepEqual(transactionIssues(value), []);

  const wrongReceipt = structuredClone(value);
  wrongReceipt.effects.push.verified_receipt.receipt.remote_tip = "e".repeat(40);
  wrongReceipt.effects.push.verified_receipt.verification.receipt.remote_tip = "e".repeat(40);
  assert.ok(
    transactionIssues(wrongReceipt).some((issue) =>
      /verified receipt identity is invalid/.test(issue)
    )
  );

  const wrongTarget = structuredClone(value);
  wrongTarget.effects.push.target.branch = "other-branch";
  wrongTarget.effects.push.verified_receipt.target.branch = "other-branch";
  wrongTarget.effects.push.verified_receipt.verification.target.branch = "other-branch";
  assert.ok(
    transactionIssues(wrongTarget).some((issue) => /target identity is invalid/.test(issue))
  );
  assert.ok(transactionIssues(wrongTarget).some((issue) => /idempotency key/.test(issue)));
});

test("release readiness consumes current canonical Review, QA, and verification evidence", () => {
  let value = transaction();
  for (const [kind, artifact, hashByte] of [
    ["review", ".pm/dev-sessions/release-example/review/report.json", "1"],
    ["qa", ".pm/dev-sessions/release-example/qa-result.json", "2"],
    ["verification", ".pm/dev-sessions/release-example/gates.json", "3"],
  ]) {
    value = bindReleaseEvidence(value, {
      kind,
      commit: COMMIT,
      artifact,
      sha256: `sha256:${hashByte.repeat(64)}`,
      checkedAt: "2026-07-14T00:10:00.000Z",
    });
  }
  assert.deepEqual(releaseReadiness(value), { ok: true, issues: [] });
  assert.throws(
    () =>
      bindReleaseEvidence(transaction(), {
        kind: "review",
        commit: "f".repeat(40),
        artifact: "review.json",
        sha256: `sha256:${"f".repeat(64)}`,
      }),
    /prepared commit/
  );
});
