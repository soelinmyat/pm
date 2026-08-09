"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const childProcess = require("node:child_process");
const { finalizeCanonicalFiles, publicKeyIdentity } = require("../scripts/delivery-attestation");
const { readProjectInput } = require("../scripts/lib/safe-project-output");
const {
  bindReleaseEvidence,
  beginEffect,
  createReleaseTransaction,
  planEffect,
  reconcileEffect,
} = require("../scripts/lib/release-transaction-schema");
const {
  createSession,
  grantAuthority,
  transitionCandidate,
} = require("../scripts/lib/dev-session-schema");
const HOOK = path.resolve(__dirname, "../hooks/push-gate");
const { deriveSessionSlug } = require("../scripts/dev-gate-check");

test("production canonical-file finalization writes once per transaction generation", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-finalize-production-"));
  const keys = crypto.generateKeyPairSync("ed25519");
  const signerIdentity = publicKeyIdentity(keys.publicKey);
  const git = (...args) => childProcess.spawnSync("git", args, { cwd: root, encoding: "utf8" });
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  fs.mkdirSync(path.join(root, ".pm"));
  const policyBytes = `${JSON.stringify({ schema_version: 1, delivery_bypass: { permitted_purposes: ["final-hook-bypass"], hook_bypass: "LEFTHOOK=0", signer_identity: signerIdentity } })}\n`;
  fs.writeFileSync(path.join(root, ".pm/repository-delivery-policy.json"), policyBytes);
  git("add", ".pm/repository-delivery-policy.json");
  git("commit", "-q", "-m", "policy");
  const commit = git("rev-parse", "HEAD").stdout.trim();
  const remote = path.join(root, ".git", "test-remote.git");
  childProcess.spawnSync("git", ["init", "--bare", "-q", remote], { encoding: "utf8" });
  git("remote", "add", "origin", remote);
  git("push", "-q", "origin", `HEAD:refs/heads/main`);
  const sessionDir = path.join(root, ".pm/dev-sessions/change");
  fs.mkdirSync(path.join(sessionDir, "ship"), { recursive: true });
  const write = (relative, value) => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(value)}\n`);
    return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")}`;
  };
  const review = ".pm/dev-sessions/change/review/report.json",
    qa = ".pm/dev-sessions/change/qa.json",
    verification = ".pm/dev-sessions/change/verification.json";
  const reviewHash = write(review, { outcome: "passed", findings: [] });
  const qaHash = write(qa, { outcome: "passed" });
  const verificationHash = write(verification, { outcome: "passed" });
  const planDigest = "sha256:" + "1".repeat(64),
    capability = "sha256:" + "2".repeat(64);
  const session = {
    run_id: "run-1",
    candidate: {
      state: "review-converged",
      invalidation: null,
      gate_plan_identity: planDigest,
      repository_capability_identity: capability,
    },
  };
  let transaction = createReleaseTransaction({
    runId: "run-1",
    slug: "change",
    repository: "test/repo",
    deliveryRemote: "origin",
    headBranch: "change",
    baseBranch: "main",
    pushUrlSha256: `sha256:${crypto.createHash("sha256").update(remote).digest("hex")}`,
    releaseMode: "delivery-only",
    preparedCommit: commit,
    manifestHashes: [],
  });
  for (const [kind, artifact, sha256] of [
    ["review", review, reviewHash],
    ["qa", qa, qaHash],
    ["verification", verification, verificationHash],
  ]) {
    transaction = bindReleaseEvidence(transaction, { kind, commit, artifact, sha256 });
  }
  transaction = planEffect(transaction, {
    effect: "push",
    target: { remote: "origin", repository: "test/repo", branch: "change", commit },
  });
  transaction = beginEffect(transaction, {
    effect: "push",
    authority: { push_feature_branch: true },
    actor: "root",
  }).transaction;
  transaction = reconcileEffect(transaction, {
    effect: "push",
    outcome: "matched",
    receipt: { remote_tip: commit },
    observation: {
      target: transaction.effects.push.target,
      receipt: { remote_tip: commit },
    },
  }).transaction;
  const plan = {
    plan_digest: planDigest,
    capability_identity: capability,
    base_commit: commit,
    merge_base_commit: commit,
    head_commit: commit,
    expected_default_ref: "refs/remotes/origin/main",
    command_identity: "sha256:" + "3".repeat(64),
    environment_identity: { id: "env" },
    adapter: { manager: { sha256: "sha256:" + "4".repeat(64) } },
    complete_commands: ["all"],
    remote: {
      name: "origin",
      url: remote,
      stdin: `refs/heads/change ${commit} refs/heads/change ${"0".repeat(40)}\n`,
    },
    repository_policy: {
      source: {
        commit,
        path: ".pm/repository-delivery-policy.json",
        sha256: `sha256:${crypto.createHash("sha256").update(policyBytes).digest("hex")}`,
      },
    },
  };
  const gates = {
    gates: ["review", "qa", "verification"].map((name) => ({
      name,
      status: "passed",
      commit,
      artifact: transaction.evidence[name].artifact,
    })),
  };
  write(".pm/dev-sessions/change/session.json", session);
  write(".pm/dev-sessions/change/ship/release-transaction.json", transaction);
  write(".pm/dev-sessions/change/gates.json", gates);
  write(".pm/dev-sessions/change/ship/repository-delivery-plan.json", plan);
  let runs = 0;
  const args = {
    root,
    session: ".pm/dev-sessions/change/session.json",
    transaction: ".pm/dev-sessions/change/ship/release-transaction.json",
    gates: ".pm/dev-sessions/change/gates.json",
    plan: ".pm/dev-sessions/change/ship/repository-delivery-plan.json",
    certification: ".pm/dev-sessions/change/ship/final-certification.json",
    attestation: ".pm/dev-sessions/change/ship/delivery-attestation.json",
  };
  let reviewReads = 0;
  const options = {
    signer: (bytes) => crypto.sign(null, bytes, keys.privateKey),
    signerId: signerIdentity,
    publicKey: keys.publicKey,
    runComplete: () => {
      runs++;
      return { outcome: "passed" };
    },
    readProjectInput: (...input) => {
      if (input[1] === review) reviewReads += 1;
      return readProjectInput(...input);
    },
  };
  const corruptTransaction = structuredClone(transaction);
  corruptTransaction.effects.push.verified_receipt.receipt.remote_tip = "f".repeat(commit.length);
  write(".pm/dev-sessions/change/ship/release-transaction.json", corruptTransaction);
  assert.throws(() => finalizeCanonicalFiles(args, options), /invalid release transaction/i);
  assert.equal(runs, 0);
  assert.equal(fs.existsSync(path.join(root, args.certification)), false);
  write(".pm/dev-sessions/change/ship/release-transaction.json", transaction);
  assert.equal(finalizeCanonicalFiles(args, options).decision, "certified");
  assert.equal(reviewReads, 1);
  assert.equal(finalizeCanonicalFiles(args, options).decision, "already-certified");
  assert.equal(runs, 1);
  assert.equal(fs.statSync(path.join(root, args.certification)).mode & 0o777, 0o600);
  const certification = JSON.parse(fs.readFileSync(path.join(root, args.certification), "utf8"));
  assert.match(certification.authentication, /^ed25519:/);
  certification.commands = ["tampered"];
  fs.writeFileSync(path.join(root, args.certification), JSON.stringify(certification));
  assert.throws(() => finalizeCanonicalFiles(args, options), /certification|signature|identity/i);
  assert.throws(
    () => finalizeCanonicalFiles({ ...args, certification: ".pm/elsewhere.json" }, options),
    /canonical.*path/i
  );
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "pm-finalize-outside-"));
  const unsafe = JSON.parse(fs.readFileSync(path.join(root, args.transaction), "utf8"));
  unsafe.slug = "other";
  fs.writeFileSync(path.join(root, args.transaction), `${JSON.stringify(unsafe)}\n`);
  fs.mkdirSync(path.join(root, ".pm/dev-sessions/other"), { recursive: true });
  fs.symlinkSync(outside, path.join(root, ".pm/dev-sessions/other/ship"), "dir");
  assert.throws(
    () =>
      finalizeCanonicalFiles(
        {
          ...args,
          certification: ".pm/dev-sessions/other/ship/final-certification.json",
          attestation: ".pm/dev-sessions/other/ship/delivery-attestation.json",
        },
        options
      ),
    /canonical|session|symlink|project root/i
  );
  assert.deepEqual(fs.readdirSync(outside), []);
  unsafe.slug = "../../../escape";
  fs.writeFileSync(path.join(root, args.transaction), `${JSON.stringify(unsafe)}\n`);
  assert.throws(
    () =>
      finalizeCanonicalFiles(
        {
          ...args,
          certification: ".pm/dev-sessions/../../../escape/ship/final-certification.json",
          attestation: ".pm/dev-sessions/../../../escape/ship/delivery-attestation.json",
        },
        options
      ),
    /canonical|slug|project root/i
  );
  fs.rmSync(outside, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
});

test("production push gate fails closed when candidate bypass trust is unavailable", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-push-bypass-production-"));
  const git = (...args) =>
    childProcess.spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("config", "push.default", "current");
  fs.writeFileSync(path.join(root, "README.md"), "x\n");
  git("add", ".");
  git("commit", "-q", "-m", "base");
  const remote = path.join(root, ".git/remote.git");
  git("init", "--bare", remote);
  git("remote", "add", "origin", remote);
  git("push", "-q", "origin", "HEAD:main");
  git("checkout", "-q", "-b", "feat/bypass");
  const slug = deriveSessionSlug("feat/bypass");
  const sessionDir = path.join(root, ".pm/dev-sessions", slug);
  fs.mkdirSync(sessionDir, { recursive: true });
  let session = createSession({ slug, sourceDir: root });
  session.candidate.route = "review-candidate";
  session = transitionCandidate(session, {
    state: "review-candidate",
    reason: "test",
    external_effect_started_at: "2026-08-10T00:00:00Z",
  });
  session = grantAuthority(session, ["push_feature_branch"], "test");
  fs.writeFileSync(path.join(sessionDir, "session.json"), JSON.stringify(session));
  fs.writeFileSync(
    path.join(sessionDir, "gates.json"),
    JSON.stringify({ schema_version: 1, run_id: session.run_id, gates: [] })
  );
  for (const assignment of ["LEFTHOOK=0", "LEFTHOOK='0'", 'LEFTHOOK="0"', "LEFTHOOK=0''"]) {
    const payload = JSON.stringify({
      tool_name: "Bash",
      cwd: root,
      tool_input: { command: `${assignment} git push origin HEAD:feat/bypass` },
    });
    const result = childProcess.spawnSync(HOOK, {
      input: payload,
      encoding: "utf8",
      env: { ...process.env, PM_PLUGIN_ROOT: path.resolve(__dirname, "..") },
    });
    assert.match(result.stdout, /deny/, assignment);
    assert.match(result.stdout, /delivery bypass denied/i, assignment);
  }
  fs.rmSync(root, { recursive: true, force: true });
});
