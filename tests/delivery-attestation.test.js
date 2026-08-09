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
} = require("../scripts/delivery-attestation");

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_C = "c".repeat(40);
const KEY = Buffer.alloc(32, 7);

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
