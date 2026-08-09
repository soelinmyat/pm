"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const crypto = require("node:crypto");
const path = require("node:path");
const {
  createDeliveryAttestation,
  verifyDeliveryAttestation,
  verifyPushBypass,
  deriveBypassPurposes,
  finalizeDeliveryCandidate,
  verifyCanonicalDeliveryAttestation,
  consumePushAuthorization,
  createCandidateDeliveryAttestation,
  publicKeyIdentity,
  verifyCanonicalCandidateAttestation,
} = require("../scripts/delivery-attestation");
const {
  bindReleaseEvidence,
  createReleaseTransaction,
} = require("../scripts/lib/release-transaction-schema");

test("canonical delivery writes reuse the shared atomic writer", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../scripts/delivery-attestation.js"),
    "utf8"
  );
  assert.match(source, /require\("\.\/lib\/project-atomic-write"\)/);
  assert.match(source, /writeProjectJsonAtomic\(root, relative/);
  assert.doesNotMatch(source, /\.tmp-\$\{process\.pid\}/);
});

test("candidate attestation grants only candidate hook bypass and binds targeted evidence", () => {
  const keys = crypto.generateKeyPairSync("ed25519");
  const value = createCandidateDeliveryAttestation(
    {
      ...input(),
      canonical_path: ".pm/dev-sessions/change/ship/candidate-attestation.json",
      commands: ["targeted"],
      evidence: [
        {
          kind: "candidate",
          path: ".pm/dev-sessions/change/candidate.json",
          sha256: "sha256:" + "9".repeat(64),
        },
      ],
      repository_policy: {
        ...input().repository_policy,
        permitted_purposes: ["candidate-hook-bypass"],
      },
    },
    {
      signer: (bytes) => crypto.sign(null, bytes, keys.privateKey),
      signer_id: publicKeyIdentity(keys.publicKey),
    }
  );
  assert.deepEqual(value.repository_policy.permitted_purposes, ["candidate-hook-bypass"]);
  assert.throws(
    () => createCandidateDeliveryAttestation({ ...input(), commands: ["all"] }, {}),
    /candidate|signer/i
  );
});

test("valid release transactions can bind the canonical candidate-attestation prerequisite", () => {
  let transaction = createReleaseTransaction({
    releaseMode: "delivery-only",
    runId: "run-candidate",
    slug: "change",
    repository: "acme/widget",
    deliveryRemote: "origin",
    headBranch: "codex/change",
    baseBranch: "main",
    pushUrlSha256: `sha256:${"8".repeat(64)}`,
    preparedCommit: SHA_C,
    manifestHashes: [],
  });
  transaction = bindReleaseEvidence(transaction, {
    kind: "candidate",
    commit: SHA_C,
    artifact: ".pm/dev-sessions/change/candidate.json",
    sha256: `sha256:${"9".repeat(64)}`,
  });
  const expected = verifyCanonicalCandidateAttestation({
    session: {
      run_id: "run-candidate",
      candidate: {
        state: "review-candidate",
        invalidation: null,
        external_effect_started_at: "2026-08-10T00:00:00.000Z",
        gate_plan_identity: `sha256:${"1".repeat(64)}`,
        repository_capability_identity: `sha256:${"2".repeat(64)}`,
      },
    },
    transaction,
    plan: {
      head_commit: SHA_C,
      base_commit: SHA_A,
      merge_base_commit: SHA_A,
      plan_digest: `sha256:${"1".repeat(64)}`,
      capability_identity: `sha256:${"2".repeat(64)}`,
      command_identity: `sha256:${"3".repeat(64)}`,
      environment_identity: { id: "environment" },
      adapter: { supported: true, manager: { sha256: `sha256:${"4".repeat(64)}` } },
      candidate_push: {
        permitted: true,
        executed_commands: ["targeted"],
        skipped_commands: [],
        declared_skipped_commands: [],
      },
      targeted_commands: ["targeted"],
      complete_commands: ["targeted"],
    },
    gates: {
      gates: [
        {
          name: "candidate",
          status: "passed",
          commit: SHA_C,
          artifact: transaction.evidence.candidate.artifact,
        },
      ],
    },
  });
  assert.deepEqual(expected.commands, ["targeted"]);
  assert.deepEqual(expected.evidence, [
    {
      kind: "candidate",
      path: transaction.evidence.candidate.artifact,
      sha256: transaction.evidence.candidate.sha256,
    },
  ]);
});

test("candidate attestation binds run, permission, plan identities, and exact adapter coverage", () => {
  const context = canonicalCandidateContext();
  assert.deepEqual(verifyCanonicalCandidateAttestation(context).commands, ["targeted"]);
  const withoutEffectMarker = structuredClone(context);
  withoutEffectMarker.session.candidate.external_effect_started_at = null;
  assert.throws(
    () => verifyCanonicalCandidateAttestation(withoutEffectMarker),
    /external-effect marker/
  );
  for (const mutate of [
    (value) => (value.session.run_id = "other-run"),
    (value) => (value.session.candidate.gate_plan_identity = `sha256:${"f".repeat(64)}`),
    (value) => (value.plan.candidate_push.permitted = false),
    (value) => (value.plan.adapter.supported = false),
    (value) => (value.plan.candidate_push.executed_commands = []),
  ]) {
    const changed = structuredClone(context);
    mutate(changed);
    assert.throws(
      () => verifyCanonicalCandidateAttestation(changed),
      /candidate|run|plan|adapter|coverage|permission/i
    );
  }
});

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_C = "c".repeat(40);
const KEY = Buffer.alloc(32, 7);
const SIGNING = crypto.generateKeyPairSync("ed25519");
const signWithTestKey = (bytes) => crypto.sign(null, bytes, SIGNING.privateKey);

function input() {
  return {
    canonical_path: ".pm/dev-sessions/change/ship/delivery-attestation.json",
    run_id: "run-1",
    commit: SHA_C,
    base: SHA_A,
    merge_base: SHA_A,
    plan_identity: "sha256:" + "1".repeat(64),
    config_identity: "sha256:" + "2".repeat(64),
    tool_identity: "sha256:" + "3".repeat(64),
    preflight_identity: "sha256:" + "4".repeat(64),
    command_identity: "sha256:" + "5".repeat(64),
    commands: ["mobile", "shared"],
    evidence: [
      {
        kind: "review",
        path: ".pm/dev-sessions/change/review/report.json",
        sha256: "sha256:" + "6".repeat(64),
      },
      {
        kind: "verification",
        path: ".pm/dev-sessions/change/verification.json",
        sha256: "sha256:" + "7".repeat(64),
      },
    ],
    producer: { name: "pm", version: "1.0.0" },
    outcome: "passed",
    invalidation: { generation: 3, findings: 0, mutated_after_review: false },
    repository_policy: {
      review_bypass: "SKIP_CODEX_REVIEW=1",
      hook_bypass: "LEFTHOOK=0",
      permitted_purposes: ["review-bypass", "final-hook-bypass"],
    },
    push: {
      remote: "origin",
      remote_url: "git@example.test/repo.git",
      ref_updates: [`refs/heads/main ${SHA_C} refs/heads/main ${SHA_B}`],
    },
    observed_at: "2026-08-10T00:00:00.000Z",
  };
}

function canonicalFinalizationContext() {
  const reviewPath = ".pm/dev-sessions/change/review/report.json";
  const qaPath = ".pm/dev-sessions/change/qa.json";
  const verificationPath = ".pm/dev-sessions/change/verification.json";
  const session = {
    run_id: "run-1",
    candidate: {
      state: "review-converged",
      invalidation: null,
      gate_plan_identity: "sha256:" + "1".repeat(64),
      repository_capability_identity: "sha256:" + "2".repeat(64),
    },
  };
  const transaction = {
    generation: 3,
    release: { prepared_commit: SHA_C },
    evidence: {
      review: { commit: SHA_C, artifact: reviewPath, sha256: "sha256:" + "6".repeat(64) },
      qa: { commit: SHA_C, artifact: qaPath, sha256: "sha256:" + "7".repeat(64) },
      verification: {
        commit: SHA_C,
        artifact: verificationPath,
        sha256: "sha256:" + "8".repeat(64),
      },
    },
  };
  const plan = {
    plan_digest: session.candidate.gate_plan_identity,
    capability_identity: session.candidate.repository_capability_identity,
    base_commit: SHA_A,
    merge_base_commit: SHA_A,
    head_commit: SHA_C,
    command_identity: "sha256:" + "5".repeat(64),
    environment_identity: { id: "env" },
    adapter: { manager: { sha256: "sha256:" + "3".repeat(64) } },
    complete_commands: ["mobile", "shared"],
  };
  const gates = {
    gates: [
      { name: "review", status: "passed", commit: SHA_C, artifact: reviewPath },
      { name: "qa", status: "passed", commit: SHA_C, artifact: qaPath },
      { name: "verification", status: "passed", commit: SHA_C, artifact: verificationPath },
    ],
  };
  return { root: "/repo", session, transaction, plan, gates };
}

function canonicalCandidateContext() {
  const transaction = createReleaseTransaction({
    releaseMode: "delivery-only",
    runId: "run-candidate",
    slug: "change",
    repository: "acme/widget",
    deliveryRemote: "origin",
    headBranch: "codex/change",
    baseBranch: "main",
    pushUrlSha256: `sha256:${"8".repeat(64)}`,
    preparedCommit: SHA_C,
    manifestHashes: [],
  });
  transaction.evidence.candidate = {
    commit: SHA_C,
    artifact: ".pm/dev-sessions/change/candidate.json",
    sha256: `sha256:${"9".repeat(64)}`,
  };
  return {
    session: {
      run_id: "run-candidate",
      candidate: {
        state: "review-candidate",
        invalidation: null,
        external_effect_started_at: "2026-08-10T00:00:00.000Z",
        gate_plan_identity: `sha256:${"1".repeat(64)}`,
        repository_capability_identity: `sha256:${"2".repeat(64)}`,
      },
    },
    transaction,
    plan: {
      head_commit: SHA_C,
      base_commit: SHA_A,
      merge_base_commit: SHA_A,
      plan_digest: `sha256:${"1".repeat(64)}`,
      capability_identity: `sha256:${"2".repeat(64)}`,
      command_identity: `sha256:${"3".repeat(64)}`,
      environment_identity: { id: "environment" },
      adapter: { supported: true, manager: { sha256: `sha256:${"4".repeat(64)}` } },
      candidate_push: {
        permitted: true,
        executed_commands: ["targeted"],
        skipped_commands: [],
        declared_skipped_commands: [],
      },
      targeted_commands: ["targeted"],
      complete_commands: ["targeted"],
    },
    gates: {
      gates: [
        {
          name: "candidate",
          status: "passed",
          commit: SHA_C,
          artifact: transaction.evidence.candidate.artifact,
        },
      ],
    },
  };
}

test("canonical attestation binds provenance and authorizes one exact push", () => {
  const attestation = createDeliveryAttestation(input(), { key: KEY });
  const expected = {
    ...input(),
    purpose: "final-hook-bypass",
    now: new Date("2026-08-10T00:01:00.000Z"),
    expectedCanonicalPath: path.normalize(input().canonical_path),
  };
  const verified = verifyDeliveryAttestation(attestation, expected, { key: KEY });
  assert.equal(verified.reusable, true);
  assert.deepEqual(verified.environment, { LEFTHOOK: "0" });
  assert.equal(verified.authorization_id, attestation.authentication);
});

test("bypass purpose comes from canonical candidate phase and rejects combined or inherited ambiguity", () => {
  assert.deepEqual(deriveBypassPurposes({ state: "review-candidate" }, { lefthook: true }), [
    "candidate-hook-bypass",
  ]);
  assert.deepEqual(deriveBypassPurposes({ state: "certifying" }, { lefthook: true }), [
    "final-hook-bypass",
  ]);
  assert.deepEqual(deriveBypassPurposes({ state: "review-converged" }, { skipReview: true }), [
    "review-bypass",
  ]);
  assert.throws(
    () => deriveBypassPurposes({ state: "reviewing" }, { lefthook: true }),
    /phase|state/i
  );
  assert.throws(
    () => deriveBypassPurposes({ state: "certifying" }, { lefthook: true, skipReview: true }),
    /combined/i
  );
});

test("canonical verifier derives provenance and rejects omitted or self-asserted identities", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-canonical-attestation-"));
  const sessionDir = path.join(root, ".pm/dev-sessions/change");
  fs.mkdirSync(path.join(sessionDir, "ship"), { recursive: true });
  const session = {
    run_id: "run-1",
    candidate: {
      state: "certifying",
      invalidation: null,
      gate_plan_identity: "sha256:" + "1".repeat(64),
      repository_capability_identity: "sha256:" + "2".repeat(64),
    },
  };
  const transaction = {
    generation: 3,
    release: { prepared_commit: SHA_C },
    evidence: {
      review: {
        commit: SHA_C,
        artifact: ".pm/dev-sessions/change/review/report.json",
        sha256: "sha256:" + "6".repeat(64),
      },
      qa: {
        commit: SHA_C,
        artifact: ".pm/dev-sessions/change/qa.json",
        sha256: "sha256:" + "7".repeat(64),
      },
      verification: {
        commit: SHA_C,
        artifact: ".pm/dev-sessions/change/verification.json",
        sha256: "sha256:" + "8".repeat(64),
      },
    },
  };
  const plan = {
    plan_digest: session.candidate.gate_plan_identity,
    capability_identity: session.candidate.repository_capability_identity,
    base_commit: SHA_A,
    merge_base_commit: SHA_A,
    head_commit: SHA_C,
    command_identity: "sha256:" + "5".repeat(64),
    environment_identity: { id: "env" },
    adapter: { manager: { sha256: "sha256:" + "3".repeat(64) } },
    complete_commands: ["mobile", "shared"],
  };
  const gates = {
    gates: [
      {
        name: "review",
        status: "passed",
        commit: SHA_C,
        artifact: transaction.evidence.review.artifact,
      },
      { name: "qa", status: "passed", commit: SHA_C, artifact: transaction.evidence.qa.artifact },
      {
        name: "verification",
        status: "passed",
        commit: SHA_C,
        artifact: transaction.evidence.verification.artifact,
      },
    ],
  };
  const expected = verifyCanonicalDeliveryAttestation({ root, session, transaction, plan, gates });
  assert.equal(expected.commit, SHA_C);
  assert.equal(expected.invalidation.generation, 3);
  assert.throws(
    () =>
      verifyCanonicalDeliveryAttestation({
        root,
        session,
        transaction,
        plan: { ...plan, command_identity: null },
        gates,
      }),
    /command/i
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test("production finalization executes once and reuse digest invalidates on plan or evidence drift", () => {
  let runs = 0;
  const context = canonicalFinalizationContext();
  const first = finalizeDeliveryCandidate(context, {
    runComplete: () => {
      runs++;
      return { outcome: "passed" };
    },
    signer: signWithTestKey,
  });
  assert.equal(first.decision, "certified");
  const reused = finalizeDeliveryCandidate(
    { ...context, existingCertification: first.certification },
    {
      runComplete: () => {
        runs++;
      },
      signer: signWithTestKey,
      publicKey: SIGNING.publicKey,
    }
  );
  assert.equal(reused.decision, "already-certified");
  assert.equal(runs, 1);
  assert.throws(
    () =>
      finalizeDeliveryCandidate(
        {
          ...context,
          plan: { ...context.plan, command_identity: "sha256:" + "9".repeat(64) },
          existingCertification: first.certification,
        },
        {
          runComplete: () => {
            runs++;
          },
          signer: signWithTestKey,
          publicKey: SIGNING.publicKey,
        }
      ),
    /review|identity|certification/i
  );
});

test("push authorization rejects any destination, ref, or head mismatch", () => {
  const attestation = createDeliveryAttestation(input(), { key: KEY });
  const expected = {
    ...input(),
    purpose: "final-hook-bypass",
    branch: "main",
    remote: "origin",
    remote_url: "git@example.test/repo.git",
    now: new Date("2026-08-10T00:01:00.000Z"),
  };
  assert.equal(verifyPushBypass(attestation, expected, { key: KEY }).reusable, true);
  for (const change of [
    { branch: "other" },
    { remote: "fork" },
    { remote_url: "git@example.test/other.git" },
    { commit: "d".repeat(40) },
  ])
    assert.equal(
      verifyPushBypass(attestation, { ...expected, ...change }, { key: KEY }).reusable,
      false
    );
});

test("production authorization uses public-key verification and consumes one release attempt", () => {
  const value = input();
  value.generation = 3;
  value.push.attempt = 2;
  const signed = createDeliveryAttestation(value, {
    signer: signWithTestKey,
    signer_id: publicKeyIdentity(SIGNING.publicKey),
  });
  assert.match(signed.authentication, /^ed25519:/);
  const consumed = new Set();
  const expected = {
    ...value,
    purpose: "final-hook-bypass",
    branch: "main",
    remote: "origin",
    remote_url: value.push.remote_url,
    old_oid: SHA_B,
    generation: 3,
    push_attempt: 2,
    now: new Date("2026-08-10T00:01:00Z"),
  };
  const first = consumePushAuthorization(signed, expected, {
    publicKey: SIGNING.publicKey,
    consume: (id) => (consumed.has(id) ? false : (consumed.add(id), true)),
  });
  assert.equal(first.reusable, true);
  assert.equal(
    consumePushAuthorization(signed, expected, {
      publicKey: SIGNING.publicKey,
      consume: (id) => (consumed.has(id) ? false : true),
    }).reusable,
    false
  );
  assert.equal(
    consumePushAuthorization(
      signed,
      { ...expected, old_oid: SHA_A },
      { publicKey: SIGNING.publicKey, consume: () => true }
    ).reusable,
    false
  );
});

test("forged, relocated, stale, unsupported, or invalidated evidence is rejected", () => {
  const attestation = createDeliveryAttestation(input(), { key: KEY });
  const expected = { ...input(), purpose: "review-bypass", now: new Date("2026-08-10T00:01:00Z") };
  for (const [name, value] of [
    ["forged", { ...attestation, command_identity: "sha256:" + "9".repeat(64) }],
    ["relocated", { ...attestation, canonical_path: ".pm/elsewhere.json" }],
    ["unsupported", { ...attestation, schema_version: 99 }],
  ]) {
    const result = verifyDeliveryAttestation(value, expected, { key: KEY });
    assert.equal(result.reusable, false, name);
  }
  assert.equal(
    verifyDeliveryAttestation(
      attestation,
      { ...expected, now: new Date("2026-08-10T01:00:00Z") },
      { key: KEY }
    ).reusable,
    false
  );
  const invalidatedInput = input();
  invalidatedInput.invalidation.findings = 1;
  const invalidated = createDeliveryAttestation(invalidatedInput, { key: KEY });
  assert.equal(verifyDeliveryAttestation(invalidated, expected, { key: KEY }).reusable, false);
});

test("canonical evidence bytes are rehashed and relocation is rejected", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-attestation-"));
  const review = path.join(root, ".pm/dev-sessions/change/review/report.json");
  const verification = path.join(root, ".pm/dev-sessions/change/verification.json");
  fs.mkdirSync(path.dirname(review), { recursive: true });
  fs.writeFileSync(review, "review\n");
  fs.writeFileSync(verification, "verification\n");
  const value = input();
  value.evidence = [
    {
      kind: "review",
      path: ".pm/dev-sessions/change/review/report.json",
      sha256: `sha256:${crypto.createHash("sha256").update("review\n").digest("hex")}`,
    },
    {
      kind: "verification",
      path: ".pm/dev-sessions/change/verification.json",
      sha256: `sha256:${crypto.createHash("sha256").update("verification\n").digest("hex")}`,
    },
  ];
  const attestation = createDeliveryAttestation(value, { key: KEY });
  const expected = { ...value, purpose: "review-bypass", now: new Date("2026-08-10T00:01:00Z") };
  assert.equal(verifyDeliveryAttestation(attestation, expected, { key: KEY, root }).reusable, true);
  fs.writeFileSync(review, "changed\n");
  assert.equal(
    verifyDeliveryAttestation(attestation, expected, { key: KEY, root }).reusable,
    false
  );
  fs.rmSync(root, { recursive: true, force: true });
});
