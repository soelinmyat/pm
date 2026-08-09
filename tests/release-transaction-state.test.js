"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const childProcess = require("node:child_process");
const { stableStringify } = require("../scripts/lib/workflow-runtime/records");
const {
  resolveAdvanceCommit,
  resolveProtectedPolicyCommit,
} = require("../scripts/release-transaction");

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

test("attestation reuse resolves the live protected branch commit", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-protected-policy-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) =>
    childProcess.spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  fs.writeFileSync(path.join(root, "README.md"), "base\n");
  git("add", ".");
  git("commit", "-q", "-m", "base");
  const expected = git("rev-parse", "HEAD").stdout.trim();
  const remote = path.join(root, "remote.git");
  git("init", "--bare", "--initial-branch=main", remote);
  git("remote", "add", "origin", remote);
  git("push", "-q", "origin", "HEAD:main");
  assert.equal(
    resolveProtectedPolicyCommit(root, {
      source: { delivery_remote: "origin", base_branch: "main" },
    }),
    expected
  );
});

test("protected branch resolution accepts SHA-256 object IDs", () => {
  const expected = "a".repeat(64);
  assert.equal(
    resolveProtectedPolicyCommit(
      process.cwd(),
      { source: { delivery_remote: "origin", base_branch: "main" } },
      () => ({ status: 0, stdout: `${expected}\trefs/heads/main\n` })
    ),
    expected
  );
});

test("release advancement binds only the exact current HEAD", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-release-advance-head-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) =>
    childProcess.spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  fs.writeFileSync(path.join(root, "README.md"), "head\n");
  git("add", ".");
  git("commit", "-q", "-m", "head");
  const head = git("rev-parse", "HEAD").stdout.trim();
  assert.equal(resolveAdvanceCommit(root, head), head);
  assert.throws(() => resolveAdvanceCommit(root, "f".repeat(head.length)), /current HEAD/);
});

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

function asLegacyCreatePr(value) {
  const legacy = structuredClone(value);
  const effect = legacy.effects["create-pr"];
  delete effect.target.draft;
  for (const attempt of effect.attempts) {
    if (attempt.receipt) delete attempt.receipt.draft;
    if (attempt.observation?.target) delete attempt.observation.target.draft;
    if (attempt.observation?.receipt) delete attempt.observation.receipt.draft;
  }
  if (effect.verified_receipt) {
    delete effect.verified_receipt.target.draft;
    delete effect.verified_receipt.receipt.draft;
    delete effect.verified_receipt.verification.target.draft;
    delete effect.verified_receipt.verification.receipt.draft;
  }
  effect.idempotency_key = `sha256:${crypto
    .createHash("sha256")
    .update(
      stableStringify({
        run_id: legacy.run_id,
        prepared_commit: legacy.release.prepared_commit,
        effect: "create-pr",
        target: effect.target,
      })
    )
    .digest("hex")}`;
  return legacy;
}

test("release transaction binds a tagless prepared commit before final evidence", () => {
  const value = transaction();
  assert.equal(value.release.tag, "v1.2.4");
  assert.equal(value.release.prepared_commit, COMMIT);
  assert.equal(value.release.tag_created, false);
  assert.deepEqual(value.evidence, { candidate: null, review: null, qa: null, verification: null });
  assert.deepEqual(transactionIssues(value), []);
});

test("candidate evidence is optional, bindable, and generation-scoped", () => {
  let value = transaction();
  const legacy = structuredClone(value);
  delete legacy.evidence.candidate;
  assert.deepEqual(transactionIssues(legacy), []);
  value = bindReleaseEvidence(value, {
    kind: "candidate",
    commit: COMMIT,
    artifact: ".pm/dev-sessions/release-example/candidate.json",
    sha256: `sha256:${"e".repeat(64)}`,
    checkedAt: "2026-07-14T00:01:00.000Z",
  });
  assert.equal(value.evidence.candidate.commit, COMMIT);
  assert.match(releaseReadiness(value).issues.join("; "), /missing review evidence/);
  for (const kind of ["review", "qa", "verification"]) {
    value = bindReleaseEvidence(value, {
      kind,
      commit: COMMIT,
      artifact: `.pm/dev-sessions/release-example/${kind}.json`,
      sha256: `sha256:${"f".repeat(64)}`,
    });
  }
  assert.equal(releaseReadiness(value).ok, true);
  value = advancePreparedCommit(value, {
    commit: "e".repeat(40),
    reason: "candidate changed",
  });
  assert.equal(value.evidence.candidate, null);
});

test("release transaction rejects traversal or multi-segment slugs", () => {
  for (const slug of ["../escape", "nested/change", ".", ".."])
    assert.throws(
      () =>
        createReleaseTransaction({
          runId: "dev_release_1",
          slug,
          repository: "acme/widget",
          deliveryRemote: "origin",
          headBranch: "codex/release-example",
          baseBranch: "main",
          pushUrlSha256: `sha256:${"c".repeat(64)}`,
          currentVersion: "1.2.3",
          nextVersion: "1.2.4",
          preparedCommit: COMMIT,
          manifestHashes: [{ path: "plugin.config.json", sha256: `sha256:${"d".repeat(64)}` }],
        }),
      /slug/i
    );
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
      draft: false,
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

test("legacy comprehensive create-pr journals resume without replay after plugin update", () => {
  let value = transaction();
  value = planEffect(value, {
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
      head: "codex/release-example",
      base: "main",
      commit: COMMIT,
      draft: false,
    },
  });
  const planned = asLegacyCreatePr(value);
  assert.deepEqual(transactionIssues(planned), []);
  const attempting = beginEffect(planned, {
    effect: "create-pr",
    authority: { create_pr: true },
    actor: "root",
  }).transaction;
  assert.deepEqual(transactionIssues(attempting), []);
  assert.equal(
    beginEffect(attempting, {
      effect: "create-pr",
      authority: { create_pr: true },
      actor: "root",
    }).decision,
    "observe-first"
  );
  const receipt = { pr_number: 42, state: "OPEN", head_oid: COMMIT };
  const verified = reconcileEffect(attempting, {
    effect: "create-pr",
    outcome: "matched",
    receipt,
    observation: { target: attempting.effects["create-pr"].target, receipt },
  }).transaction;
  assert.deepEqual(transactionIssues(verified), []);
  assert.equal(
    beginEffect(verified, {
      effect: "create-pr",
      authority: { create_pr: true },
      actor: "root",
    }).decision,
    "already-verified"
  );
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

test("optimized delivery journals the draft-to-ready PR mutation before merge", () => {
  let value = bindReleaseEvidence(transaction(), {
    kind: "candidate",
    commit: COMMIT,
    artifact: ".pm/dev-sessions/release-example/ship/candidate-attestation.json",
    sha256: `sha256:${"e".repeat(64)}`,
  });
  value = planEffect(value, {
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
  value = reconcileEffect(value, {
    effect: "push",
    outcome: "matched",
    receipt: { remote_tip: COMMIT },
    observation: {
      target: value.effects.push.target,
      receipt: { remote_tip: COMMIT },
    },
  }).transaction;
  value = planEffect(value, {
    effect: "create-pr",
    target: {
      repository: "acme/widget",
      head: "codex/release-example",
      base: "main",
      commit: COMMIT,
      draft: true,
    },
  });
  value = beginEffect(value, {
    effect: "create-pr",
    authority: { create_pr: true },
    actor: "root",
  }).transaction;
  const readyTooEarly = { pr_number: 42, state: "OPEN", head_oid: COMMIT, draft: false };
  assert.throws(
    () =>
      reconcileEffect(value, {
        effect: "create-pr",
        outcome: "matched",
        receipt: readyTooEarly,
        observation: { target: value.effects["create-pr"].target, receipt: readyTooEarly },
      }),
    /draft.*receipt/i
  );
  const prReceipt = { pr_number: 42, state: "OPEN", head_oid: COMMIT, draft: true };
  value = reconcileEffect(value, {
    effect: "create-pr",
    outcome: "matched",
    receipt: prReceipt,
    observation: { target: value.effects["create-pr"].target, receipt: prReceipt },
  }).transaction;
  value = planEffect(value, {
    effect: "merge",
    target: {
      repository: "acme/widget",
      pr_number: 42,
      head_commit: COMMIT,
      base: "main",
      method: "squash",
    },
  });
  assert.throws(
    () =>
      beginEffect(value, {
        effect: "merge",
        authority: { merge: true },
        actor: "root",
        candidateState: "merge-ready",
      }),
    /requires verified effect ready-pr/
  );
  value = planEffect(value, {
    effect: "ready-pr",
    target: { repository: "acme/widget", pr_number: 42, commit: COMMIT },
  });
  assert.throws(
    () =>
      beginEffect(value, {
        effect: "ready-pr",
        authority: { create_pr: true },
        actor: "root",
        candidateState: "certifying",
      }),
    /requires candidate state merge-ready/
  );
  value = beginEffect(value, {
    effect: "ready-pr",
    authority: { create_pr: true },
    actor: "root",
    candidateState: "merge-ready",
  }).transaction;
  const readyReceipt = { pr_number: 42, state: "OPEN", head_oid: COMMIT, draft: false };
  value = reconcileEffect(value, {
    effect: "ready-pr",
    outcome: "matched",
    receipt: readyReceipt,
    observation: { target: value.effects["ready-pr"].target, receipt: readyReceipt },
  }).transaction;
  assert.equal(value.effects["ready-pr"].status, "verified");
  assert.deepEqual(transactionIssues(value), []);
  assert.throws(
    () =>
      beginEffect(value, {
        effect: "merge",
        authority: { merge: true },
        actor: "root",
        candidateState: "invalidated",
      }),
    /requires candidate state merge-ready/
  );
  const merge = beginEffect(value, {
    effect: "merge",
    authority: { merge: true },
    actor: "root",
    candidateState: "merge-ready",
  });
  assert.equal(merge.decision, "execute");
  assert.throws(
    () =>
      beginEffect(merge.transaction, {
        effect: "merge",
        authority: { merge: true },
        actor: "root",
        candidateState: "invalidated",
      }),
    /requires candidate state merge-ready/
  );
  const mergeReceipt = {
    pr_number: 42,
    state: "MERGED",
    head_oid: COMMIT,
    merge_sha: MERGE,
  };
  const observedAfterInvalidation = reconcileEffect(merge.transaction, {
    effect: "merge",
    outcome: "matched",
    receipt: mergeReceipt,
    observation: { target: merge.transaction.effects.merge.target, receipt: mergeReceipt },
    candidateState: "invalidated",
  });
  assert.equal(observedAfterInvalidation.decision, "verified");
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
  assert.deepEqual(value.evidence, { candidate: null, review: null, qa: null, verification: null });
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
          draft: false,
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

  const replayableVerifiedAttempt = structuredClone(value);
  replayableVerifiedAttempt.effects.push.status = "planned";
  replayableVerifiedAttempt.effects.push.verified_receipt = null;
  assert.ok(
    transactionIssues(replayableVerifiedAttempt).some((issue) =>
      /planned effect must be new or follow an absent observation/.test(issue)
    )
  );

  const unknownAttempt = structuredClone(value);
  unknownAttempt.effects.push.attempts[0].status = "maybe-complete";
  assert.ok(
    transactionIssues(unknownAttempt).some((issue) => /attempt status is invalid/.test(issue))
  );
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
