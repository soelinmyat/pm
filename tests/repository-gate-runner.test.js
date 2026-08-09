"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");
const { runRepositoryGates } = require("../scripts/repository-gate-runner");

const OLD_SHA = "a".repeat(40);
const NEW_SHA = "b".repeat(40);
const OTHER_SHA = "c".repeat(40);

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-gate-runner-"));
  const hook = path.join(root, "pre-push");
  fs.writeFileSync(hook, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  const realpath = fs.realpathSync(hook);
  const sha256 = `sha256:${crypto.createHash("sha256").update(fs.readFileSync(hook)).digest("hex")}`;
  const environment = { runtimes: [], path_digest: "x", allowlisted_env_digest: "y", services: [] };
  const plan = {
    plan_digest: "plan-v1",
    capability_identity: "cap-v1",
    environment_identity: environment,
    repository_root: root,
    base_commit: NEW_SHA,
    head_commit: OLD_SHA,
    source_ref: "refs/heads/x",
    expected_default_ref: "refs/remotes/origin/main",
    targeted_commands: ["mobile", "shared"],
    complete_commands: ["mobile", "shared"],
    hook,
    hook_identity: { path: hook, realpath, sha256 },
    remote: {
      name: "origin",
      url: "git@example/x",
      stdin: `refs/heads/x ${OLD_SHA} refs/heads/x ${NEW_SHA}\n`,
    },
    candidate_push: { permitted: true },
    adapter: {
      supported: true,
      manager: {
        path: "/trusted/lefthook",
        realpath: "/trusted/lefthook",
        sha256: "sha256:manager",
        version: "1.0.0",
      },
      hook_contract: { kind: "direct-manager-pre-push-v1" },
      manager_environment: { PATH: "/trusted/bin:/usr/bin:/bin" },
    },
  };
  const options = {
    expectedPlanDigest: "plan-v1",
    expectedCapabilityIdentity: "cap-v1",
    verifyDigest: () => true,
    preflight: () => ({ status: "verified", identity: environment }),
    discoverCapabilities: () => ({ identity: "cap-v1" }),
    verifyManager: () => true,
    resolveHead: () => OLD_SHA,
    resolveDefaultRef: () => NEW_SHA,
  };
  return { root, hook, plan, options };
}

test("invokes installed pre-push hook once with faithful Git input", () => {
  const { root, plan, options } = fixture();
  const calls = [];
  const result = runRepositoryGates(plan, "targeted", {
    ...options,
    spawnSync: (file, args, opts) => {
      calls.push({ file, args, opts });
      return { status: 0, stdout: "", stderr: "" };
    },
  });
  assert.equal(result.status, "passed");
  assert.deepEqual(calls[0].args, [
    "run",
    "pre-push",
    "--command",
    "mobile",
    "--command",
    "shared",
    "origin",
    "git@example/x",
  ]);
  assert.equal(calls[0].opts.input, plan.remote.stdin);
  assert.equal(calls[0].opts.shell, false);
  fs.rmSync(root, { recursive: true, force: true });
});

test("comprehensive fallback blocks when no real executor is supplied", () => {
  const { root, plan, options } = fixture();
  plan.adapter.supported = false;
  const result = runRepositoryGates(plan, "targeted", options);
  assert.equal(result.status, "blocked");
  assert.equal(result.exit_code, 1);
  assert.equal(result.reason, "comprehensive-executor-required");
  fs.rmSync(root, { recursive: true, force: true });
});

test("comprehensive fallback invokes the supplied executor exactly once", () => {
  const { root, plan, options } = fixture();
  plan.adapter.supported = false;
  let calls = 0;
  const result = runRepositoryGates(plan, "targeted", {
    ...options,
    comprehensivePush: (reason) => {
      calls++;
      assert.equal(reason, "unsupported-or-unclear-hook-contract");
      return { status: "comprehensive", exit_code: 0 };
    },
  });
  assert.equal(result.status, "comprehensive");
  assert.equal(calls, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test("externally expected digest and capability identity are mandatory", () => {
  const { root, plan, options } = fixture();
  for (const changed of [
    { expectedPlanDigest: undefined },
    { expectedPlanDigest: "other" },
    { expectedCapabilityIdentity: undefined },
    { expectedCapabilityIdentity: "other" },
  ]) {
    const result = runRepositoryGates(plan, "targeted", { ...options, ...changed });
    assert.equal(result.status, "blocked");
  }
  fs.rmSync(root, { recursive: true, force: true });
});

test("optimized execution re-discovers and binds the live capability identity", () => {
  const { root, plan, options } = fixture();
  let ran = false;
  const result = runRepositoryGates(plan, "targeted", {
    ...options,
    discoverCapabilities: () => ({ identity: "cap-live-drift" }),
    spawnSync: () => {
      ran = true;
      return { status: 0 };
    },
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "live-capability-identity-mismatch");
  assert.equal(ran, false);
  fs.rmSync(root, { recursive: true, force: true });
});

test("optimized execution pins the authenticated manager and never lets the hook resolve an alternate", () => {
  const { root, hook, plan, options } = fixture();
  const managerRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pm-pinned-manager-"));
  const manager = path.join(managerRoot, "lefthook");
  fs.writeFileSync(manager, "manager bytes\n", { mode: 0o700 });
  const managerIdentity = {
    path: manager,
    realpath: fs.realpathSync(manager),
    sha256: `sha256:${crypto.createHash("sha256").update(fs.readFileSync(manager)).digest("hex")}`,
    version: "1.0.0",
  };
  plan.adapter = {
    supported: true,
    manager: managerIdentity,
    hook_contract: { kind: "direct-manager-pre-push-v1" },
    manager_environment: { PATH: "/trusted/bin:/usr/bin:/bin" },
  };
  const calls = [];
  const result = runRepositoryGates(plan, "targeted", {
    ...options,
    verifyManager: () => true,
    spawnSync: (file, args, spawnOptions) => {
      calls.push({ file, args, spawnOptions });
      return { status: 0, stdout: "", stderr: "" };
    },
  });
  assert.equal(result.status, "passed");
  assert.equal(calls[0].file, managerIdentity.realpath);
  assert.notEqual(calls[0].file, hook);
  assert.deepEqual(calls[0].args, [
    "run",
    "pre-push",
    "--command",
    "mobile",
    "--command",
    "shared",
    "origin",
    "git@example/x",
  ]);
  assert.equal(calls[0].spawnOptions.input, plan.remote.stdin);
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(managerRoot, { recursive: true, force: true });
});

test("optimized execution strips ambient bypasses and PM authentication secrets", () => {
  const { root, plan, options } = fixture();
  let executionEnv;
  const result = runRepositoryGates(plan, "targeted", {
    ...options,
    env: {
      PATH: "/ambient/bin",
      HOME: "/tmp/example-home",
      LEFTHOOK: "0",
      LEFTHOOK_EXCLUDE: "pre-push",
      SKIP_CODEX_REVIEW: "1",
      PM_REPOSITORY_RECEIPT_KEY: "receipt-secret".repeat(4),
      PM_REPOSITORY_IDENTITY_KEY: "identity-secret".repeat(4),
    },
    spawnSync: (_file, _args, spawnOptions) => {
      executionEnv = spawnOptions.env;
      return { status: 0, stdout: "", stderr: "" };
    },
  });
  assert.equal(result.status, "passed");
  assert.equal(executionEnv.PATH, plan.adapter.manager_environment.PATH);
  assert.equal(executionEnv.HOME, "/tmp/example-home");
  assert.equal(executionEnv.LEFTHOOK, undefined);
  assert.equal(executionEnv.LEFTHOOK_EXCLUDE, undefined);
  assert.equal(executionEnv.SKIP_CODEX_REVIEW, undefined);
  assert.equal(executionEnv.PM_REPOSITORY_RECEIPT_KEY, undefined);
  assert.equal(executionEnv.PM_REPOSITORY_IDENTITY_KEY, undefined);
  fs.rmSync(root, { recursive: true, force: true });
});

test("hook bytes and realpath are revalidated immediately before execution", () => {
  const { root, hook, plan, options } = fixture();
  fs.writeFileSync(hook, "#!/bin/sh\nexit 1\n");
  let ran = false;
  const result = runRepositoryGates(plan, "targeted", {
    ...options,
    spawnSync: () => {
      ran = true;
    },
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "hook-identity-mismatch");
  assert.equal(ran, false);
  fs.rmSync(root, { recursive: true, force: true });
});

test("malformed ref-update input and unverified environments cannot run optimized gates", () => {
  const { root, plan, options } = fixture();
  let ran = false;
  plan.remote.stdin = `refs/heads/x ${OLD_SHA} refs/heads/x ${NEW_SHA}\nINJECT`;
  let result = runRepositoryGates(plan, "targeted", {
    ...options,
    spawnSync: () => {
      ran = true;
    },
  });
  assert.equal(result.status, "blocked");
  assert.equal(ran, false);
  plan.remote.stdin = `refs/heads/x ${OLD_SHA} refs/heads/x ${NEW_SHA}\n`;
  result = runRepositoryGates(plan, "targeted", {
    ...options,
    preflight: () => ({ status: "unverified", identity: plan.environment_identity }),
  });
  assert.equal(result.status, "blocked");
  fs.rmSync(root, { recursive: true, force: true });
});

test("optimized execution binds one exact branch update to the live planned head", () => {
  const { root, plan, options } = fixture();
  for (const stdin of [
    `refs/heads/other ${OLD_SHA} refs/heads/other ${NEW_SHA}\n`,
    `refs/heads/x ${NEW_SHA} refs/heads/x ${OLD_SHA}\n`,
    `refs/heads/x ${OLD_SHA} refs/heads/x ${OLD_SHA}\n`,
    `refs/heads/x ${OLD_SHA} refs/heads/x ${OTHER_SHA}\n`,
    `${plan.remote.stdin}refs/heads/y ${OLD_SHA} refs/heads/y ${NEW_SHA}\n`,
  ]) {
    let ran = false;
    const result = runRepositoryGates({ ...plan, remote: { ...plan.remote, stdin } }, "targeted", {
      ...options,
      spawnSync: () => {
        ran = true;
        return { status: 0 };
      },
    });
    assert.equal(result.status, "blocked");
    assert.equal(result.reason, "invalid-git-push-input");
    assert.equal(ran, false);
  }
  const stale = runRepositoryGates(plan, "targeted", {
    ...options,
    resolveHead: () => NEW_SHA,
    spawnSync: () => ({ status: 0 }),
  });
  assert.equal(stale.status, "blocked");
  assert.equal(stale.reason, "invalid-git-push-input");
  fs.rmSync(root, { recursive: true, force: true });
});

test("hook diagnostics are bounded and redact authorization, token, and DSN values", () => {
  const { root, plan, options } = fixture();
  const result = runRepositoryGates(plan, "targeted", {
    ...options,
    spawnSync: () => ({
      status: 1,
      stderr:
        "Authorization: Bearer abc123 token=shhh postgres://user:pass@db/prod " + "x".repeat(9000),
    }),
  });
  assert.equal(result.status, "failed");
  assert.doesNotMatch(result.stderr, /abc123|shhh|user:pass/);
  assert.ok(Buffer.byteLength(result.stderr) <= 8192);
  fs.rmSync(root, { recursive: true, force: true });
});

test("preflight issues and uncaught CLI errors are redacted at the final boundary", () => {
  const { root, plan, options } = fixture();
  const result = runRepositoryGates(plan, "targeted", {
    ...options,
    preflight: () => ({
      status: "blocked",
      identity: {},
      issues: [
        { kind: "runtime", message: "Authorization: Bearer issue-secret token=also-secret" },
      ],
    }),
  });
  assert.doesNotMatch(JSON.stringify(result), /issue-secret|also-secret/);
  const cli = childProcess.spawnSync(
    process.execPath,
    [
      path.join(__dirname, "../scripts/repository-gate-runner.js"),
      "--plan",
      path.join(root, "token=cli-secret.json"),
      "--mode",
      "targeted",
      "--expected-plan-digest",
      "x",
      "--expected-capability-identity",
      "y",
      "--discovery-receipt",
      path.join(root, "receipt.json"),
      "--discovery-receipt-sha256",
      `sha256:${"a".repeat(64)}`,
    ],
    { encoding: "utf8", shell: false }
  );
  assert.notEqual(cli.status, 0);
  assert.doesNotMatch(cli.stderr, /cli-secret/);
  fs.rmSync(root, { recursive: true, force: true });
});
