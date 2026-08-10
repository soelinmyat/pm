"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");
const {
  discoverRepositoryCapabilities,
  instructionFiles,
  receiptAuthentication,
} = require("../scripts/lib/repository-capabilities");
const { stableObjectHmac } = require("../scripts/lib/stable-authentication");
const { digest } = require("../scripts/lib/repository-gate-plan-schema");
const { keyedIdentity } = require("../scripts/repository-environment-preflight");
const COMMAND_IDENTITY = `sha256:${"a".repeat(64)}`;

test("discovers instructions, runtimes, hooks, workflows and policy without writes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-repo-cap-"));
  fs.mkdirSync(path.join(root, ".git/hooks"), { recursive: true });
  fs.mkdirSync(path.join(root, ".github/workflows"), { recursive: true });
  fs.mkdirSync(path.join(root, ".pm"), { recursive: true });
  fs.writeFileSync(path.join(root, "AGENTS.md"), "rules\n");
  fs.writeFileSync(path.join(root, ".nvmrc"), "24.4.1\n");
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ engines: { node: ">=24 <25" }, scripts: { test: "node --test" } })
  );
  fs.writeFileSync(path.join(root, ".git/hooks/pre-push"), "#!/bin/sh\n");
  fs.writeFileSync(
    path.join(root, ".github/workflows/ci.yml"),
    "uses: actions/setup-node@v4\nwith:\n  node-version: 20\n"
  );
  fs.writeFileSync(
    path.join(root, ".pm/repository-delivery-policy.json"),
    JSON.stringify({
      schema_version: 1,
      candidate_push: {
        permitted: true,
        candidate_commands: ["mobile"],
        skipped_commands: [],
        command_identity: COMMAND_IDENTITY,
      },
      delivery_bypass: {
        permitted_purposes: ["candidate-hook-bypass", "final-hook-bypass"],
        hook_bypass: "LEFTHOOK=0",
        signer_identity: COMMAND_IDENTITY,
      },
    })
  );
  const before = snapshot(root);
  const policyBytes = fs.readFileSync(
    path.join(root, ".pm/repository-delivery-policy.json"),
    "utf8"
  );
  const found = discoverRepositoryCapabilities(root, {
    policyVerifier: () => ({
      verified: true,
      bytes: policyBytes,
      source: "git:abc:.pm/repository-delivery-policy.json",
      identity: "abc",
    }),
  });
  assert.equal(found.runtimes.filter((x) => x.scope === "local").length, 2);
  assert.equal(
    found.runtimes.some((x) => x.scope === "ci"),
    true
  );
  assert.equal(found.policy.candidate_push.permitted, true);
  assert.deepEqual(found.policy.delivery_bypass.permitted_purposes, [
    "candidate-hook-bypass",
    "final-hook-bypass",
  ]);
  assert.equal(found.hooks.pre_push.exists, true);
  assert.deepEqual(snapshot(root), before);
  fs.rmSync(root, { recursive: true, force: true });
});

test("capability discovery rejects oversized runtime and probe inventories", () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pm-repo-runtime-limit-"));
  fs.mkdirSync(path.join(runtimeRoot, ".git/hooks"), { recursive: true });
  fs.writeFileSync(
    path.join(runtimeRoot, ".tool-versions"),
    Array.from({ length: 65 }, (_, index) => `tool-${index} 1.0.0`).join("\n")
  );
  assert.throws(
    () => discoverRepositoryCapabilities(runtimeRoot),
    /runtime declaration count exceeds limit/
  );
  fs.rmSync(runtimeRoot, { recursive: true, force: true });

  const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pm-repo-package-limit-"));
  fs.mkdirSync(path.join(packageRoot, ".git/hooks"), { recursive: true });
  fs.writeFileSync(
    path.join(packageRoot, ".tool-versions"),
    Array.from({ length: 64 }, (_, index) => `tool-${index} 1.0.0`).join("\n")
  );
  fs.writeFileSync(
    path.join(packageRoot, "package.json"),
    JSON.stringify({ engines: { node: ">=20" } })
  );
  assert.throws(
    () => discoverRepositoryCapabilities(packageRoot),
    /runtime declaration count exceeds limit/
  );
  fs.rmSync(packageRoot, { recursive: true, force: true });

  const probeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pm-repo-probe-limit-"));
  fs.mkdirSync(path.join(probeRoot, ".git/hooks"), { recursive: true });
  const policy = JSON.stringify({
    schema_version: 1,
    candidate_push: { permitted: false },
    probes: Array.from({ length: 33 }, () => ({
      adapter: "postgres-identity-v1",
      expected: { database: "db" },
    })),
  });
  const found = discoverRepositoryCapabilities(probeRoot, {
    policyVerifier: () => ({
      verified: true,
      bytes: policy,
      source: "git:abc:.pm/repository-delivery-policy.json",
      identity: "abc",
    }),
  });
  assert.equal(found.policy.provenance, "malformed");
  assert.deepEqual(found.policy.probes, []);
  fs.rmSync(probeRoot, { recursive: true, force: true });
});

test("instruction fallback scanning has a hard visited-entry bound", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-instruction-bound-"));
  for (let index = 0; index < 5; index += 1)
    fs.mkdirSync(path.join(root, `wide-${index}`), { recursive: true });
  assert.throws(() => instructionFiles(root, 128, 4), /entry budget/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("receipt and delivery authentication share stable-object HMAC bytes", () => {
  const value = { z: 1, nested: { b: 2, a: 1 }, authentication: "old" };
  const key = Buffer.alloc(32, 6);
  assert.equal(receiptAuthentication(value, key), stableObjectHmac(value, key));
  assert.equal(stableObjectHmac(value, Buffer.alloc(8)), null);
});

test("merged Lefthook JSON supplies exact command identities without executing commands", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-repo-lefthook-"));
  const managerRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pm-trusted-lefthook-"));
  const manager = path.join(managerRoot, "lefthook");
  const lefthookDump = {
    "pre-push": { commands: { mobile: { glob: "apps/mobile/**", run: "pnpm mobile" } } },
  };
  fs.writeFileSync(
    manager,
    `#!/bin/sh\nif [ "$1" = "version" ]; then printf '1.12.3\\n'; else printf '%s\\n' '${JSON.stringify(lefthookDump)}'; fi\n`,
    { mode: 0o700 }
  );
  const managerIdentity = {
    path: manager,
    realpath: fs.realpathSync(manager),
    sha256: `sha256:${cryptoHash(fs.readFileSync(manager))}`,
    version: "1.12.3",
  };
  const signed = signedOptions(root, {
    lefthook: {
      identity: "manager-receipt-v1",
      manager: managerIdentity,
      dump: lefthookDump,
      dump_digest: digest(lefthookDump),
      hook_contract: { kind: "direct-manager-pre-push-v1" },
      manager_environment: { PATH: "/trusted/bin:/usr/bin:/bin" },
    },
  });
  const found = discoverRepositoryCapabilities(root, signed.options);
  assert.equal(found.lefthook.commands.mobile.run, "pnpm mobile");
  assert.equal(found.lefthook.manager_version, "1.12.3");
  assert.equal(
    discoverRepositoryCapabilities(root, {
      ...signed.options,
      discoveryReceipt: { ...signed.receipt, identity: "self-labeled" },
    }).lefthook.supported,
    false
  );
  fs.appendFileSync(manager, "# drift\n");
  assert.equal(discoverRepositoryCapabilities(root, signed.options).lefthook.supported, false);
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(managerRoot, { recursive: true, force: true });
});

test("candidate policy is visible but cannot authorize when no protected root is supplied", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-candidate-only-policy-"));
  fs.mkdirSync(path.join(root, ".pm"));
  fs.writeFileSync(
    path.join(root, ".pm/repository-delivery-policy.json"),
    JSON.stringify({
      schema_version: 1,
      candidate_push: {
        permitted: true,
        candidate_commands: ["x"],
        skipped_commands: [],
        command_identity: COMMAND_IDENTITY,
      },
    })
  );
  const found = discoverRepositoryCapabilities(root);
  assert.equal(found.policy.provenance, "candidate");
  fs.rmSync(root, { recursive: true, force: true });
});

test("caller-labeled protected root cannot authorize candidate policy", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-repo-policy-"));
  const protectedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pm-base-policy-"));
  fs.mkdirSync(path.join(root, ".pm"));
  fs.mkdirSync(path.join(protectedRoot, ".pm"));
  fs.writeFileSync(
    path.join(root, ".pm/repository-delivery-policy.json"),
    JSON.stringify({
      schema_version: 1,
      candidate_push: {
        permitted: true,
        candidate_commands: [],
        skipped_commands: [],
        command_identity: COMMAND_IDENTITY,
      },
    })
  );
  fs.writeFileSync(
    path.join(protectedRoot, ".pm/repository-delivery-policy.json"),
    JSON.stringify({ schema_version: 1, candidate_push: { permitted: false } })
  );
  const policy = discoverRepositoryCapabilities(root, { protectedRoot }).policy;
  assert.equal(policy.provenance, "candidate");
  assert.equal(policy.candidate_push.permitted, true);
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(protectedRoot, { recursive: true, force: true });
});

test("protected policy bytes come from the exact verified Git commit", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-git-policy-"));
  fs.mkdirSync(path.join(root, ".pm"));
  const policyPath = path.join(root, ".pm/repository-delivery-policy.json");
  fs.writeFileSync(
    policyPath,
    JSON.stringify({ schema_version: 1, candidate_push: { permitted: false } })
  );
  const git = (args) =>
    childProcess.spawnSync("git", args, { cwd: root, encoding: "utf8", shell: false });
  git(["init"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Test"]);
  git(["add", ".pm/repository-delivery-policy.json"]);
  git(["commit", "-m", "protected policy"]);
  const commit = git(["rev-parse", "HEAD"]).stdout.trim();
  fs.writeFileSync(
    policyPath,
    JSON.stringify({
      schema_version: 1,
      candidate_push: {
        permitted: true,
        candidate_commands: [],
        skipped_commands: [],
        command_identity: COMMAND_IDENTITY,
      },
    })
  );
  const found = discoverRepositoryCapabilities(root, {
    protectedCommit: commit,
    expectedProtectedCommit: commit,
  });
  assert.equal(found.policy.provenance, "candidate");
  const remoteRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pm-policy-remote-"));
  git(["init", "--bare", remoteRoot]);
  git(["remote", "add", "origin", remoteRoot]);
  git(["push", "-u", "origin", "HEAD:main"]);
  const remoteUrl = git(["remote", "get-url", "--push", "origin"]).stdout.trim();
  const remoteCommit = git(["rev-parse", "refs/remotes/origin/main"]).stdout.trim();
  const signed = signedOptions(root, {
    repositoryHead: commit,
    protectedCommit: commit,
    defaultBranch: {
      identity: "remote-main-v1",
      remote: "origin",
      remote_url: remoteUrl,
      ref: "refs/remotes/origin/main",
      commit: remoteCommit,
    },
  });
  const authenticated = discoverRepositoryCapabilities(root, signed.options);
  assert.equal(authenticated.policy.provenance, "authenticated");
  assert.equal(authenticated.policy.candidate_push.permitted, false);
  assert.match(authenticated.policy.authority, new RegExp(commit));
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(remoteRoot, { recursive: true, force: true });
});

test("malformed or stdin-sensitive Lefthook contracts make the adapter unsupported", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-lefthook-unsupported-"));
  const lefthookDump = {
    "pre-push": {
      commands: {
        valid: { run: "pnpm test", glob: "src/**", exclude: "vendor/**" },
        malformed: { run: ["pnpm", "test"] },
        sensitive: { run: "read value", stdin: true },
      },
    },
  };
  const found = require("../scripts/lib/repository-capabilities").parseLefthookDump(lefthookDump);
  assert.equal(found.supported, false);
  assert.ok(found.issues.length >= 2);
  assert.deepEqual(found.commands, {});
  fs.rmSync(root, { recursive: true, force: true });
});

test("unsupported Lefthook glob grammar fails the complete adapter closed", () => {
  const parsed = require("../scripts/lib/repository-capabilities").parseLefthookDump({
    "pre-push": { commands: { unsafe: { run: "pnpm test", glob: "src/[^a]/**" } } },
  });
  assert.equal(parsed.supported, false);
  assert.deepEqual(parsed.commands, {});
});

test("hook-level Lefthook semantics outside the normalized contract fail closed", () => {
  const parsed = require("../scripts/lib/repository-capabilities").parseLefthookDump({
    "pre-push": {
      files: "printf nothing",
      commands: { tests: { run: "pnpm test", glob: "src/**" } },
    },
  });
  assert.equal(parsed.supported, false);
  assert.deepEqual(parsed.commands, {});
});

test("GitHub optimization facts require an externally bound authenticated receipt", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-github-cap-"));
  const absent = discoverRepositoryCapabilities(root);
  assert.equal(absent.github_capabilities.available, false);
  const facts = {
    branch_protection: true,
    required_checks: true,
    merge_queue: false,
  };
  const signed = signedOptions(root, { github: { identity: "github-v1", facts } });
  const authenticated = discoverRepositoryCapabilities(root, signed.options);
  assert.deepEqual(authenticated.github_capabilities, {
    available: true,
    identity: "github-v1",
    facts,
  });
  fs.rmSync(root, { recursive: true, force: true });
});

test("discovery never executes a repository-controlled Lefthook binary", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-lefthook-binary-"));
  const bin = path.join(root, "node_modules/.bin");
  const marker = path.join(root, "executed");
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, "lefthook"), `#!/bin/sh\ntouch ${marker}\n`, { mode: 0o700 });
  const found = discoverRepositoryCapabilities(root);
  assert.equal(found.lefthook.supported, false);
  assert.equal(fs.existsSync(marker), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test("capability discovery never executes even an authenticated receipt manager", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-discovery-no-exec-"));
  const managerRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pm-discovery-manager-"));
  const marker = path.join(root, "manager-executed");
  const manager = path.join(managerRoot, "lefthook");
  const dump = { "pre-push": { commands: { mobile: { run: "pnpm test", glob: "src/**" } } } };
  fs.writeFileSync(
    manager,
    `#!/bin/sh\ntouch '${marker}'\nif [ "$1" = version ]; then printf '1.0.0\\n'; else printf '%s\\n' '${JSON.stringify(dump)}'; fi\n`,
    { mode: 0o700 }
  );
  const managerIdentity = {
    path: manager,
    realpath: fs.realpathSync(manager),
    sha256: `sha256:${cryptoHash(fs.readFileSync(manager))}`,
    version: "1.0.0",
  };
  const signed = signedOptions(root, {
    lefthook: {
      identity: "manager",
      manager: managerIdentity,
      dump,
      dump_digest: digest(dump),
      hook_contract: { kind: "direct-manager-pre-push-v1" },
      manager_environment: { PATH: "/trusted/bin:/usr/bin:/bin" },
    },
  });
  const found = discoverRepositoryCapabilities(root, signed.options);
  assert.equal(found.lefthook.supported, true);
  assert.equal(fs.existsSync(marker), false);
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(managerRoot, { recursive: true, force: true });
});

test("discovery receipts require a fresh machine-keyed repository/head binding", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-signed-discovery-"));
  const key = Buffer.alloc(32, 4);
  const now = new Date("2026-08-10T00:00:00.000Z");
  const signed = signedOptions(root, {
    key,
    now,
    github: {
      identity: "github-v1",
      facts: { branch_protection: true, required_checks: true, merge_queue: false },
    },
  });
  const receipt = signed.receipt;
  const common = signed.options;
  assert.equal(discoverRepositoryCapabilities(root, common).github_capabilities.available, true);
  const forged = {
    ...receipt,
    github: { ...receipt.github, facts: { ...receipt.github.facts, merge_queue: true } },
  };
  assert.equal(
    discoverRepositoryCapabilities(root, { ...common, discoveryReceipt: forged })
      .github_capabilities.available,
    false
  );
  const stale = signDiscovery(
    { ...receipt, authentication: undefined, observed_at: "2026-08-09T00:00:00.000Z" },
    key
  );
  assert.equal(
    discoverRepositoryCapabilities(root, { ...common, discoveryReceipt: stale }).github_capabilities
      .available,
    false
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test("revoked policy on the current remote default head cannot reuse an allowed ancestor", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-policy-revoked-"));
  const remoteRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pm-policy-revoked-remote-"));
  const git = (args) =>
    childProcess.spawnSync("git", args, { cwd: root, encoding: "utf8", shell: false });
  git(["init"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Test"]);
  fs.mkdirSync(path.join(root, ".pm"));
  const policy = path.join(root, ".pm/repository-delivery-policy.json");
  fs.writeFileSync(
    policy,
    JSON.stringify({ schema_version: 1, candidate_push: { permitted: true } })
  );
  git(["add", ".pm/repository-delivery-policy.json"]);
  git(["commit", "-m", "allow"]);
  const allowed = git(["rev-parse", "HEAD"]).stdout.trim();
  childProcess.spawnSync("git", ["init", "--bare", remoteRoot], { encoding: "utf8", shell: false });
  git(["remote", "add", "origin", remoteRoot]);
  git(["push", "origin", "HEAD:main"]);
  fs.writeFileSync(
    policy,
    JSON.stringify({ schema_version: 1, candidate_push: { permitted: false } })
  );
  git(["add", ".pm/repository-delivery-policy.json"]);
  git(["commit", "-m", "revoke"]);
  git(["push", "origin", "HEAD:main"]);
  const remoteUrl = git(["remote", "get-url", "--push", "origin"]).stdout.trim();
  const current = git(["rev-parse", "refs/remotes/origin/main"]).stdout.trim();
  const signed = signedOptions(root, {
    repositoryHead: current,
    protectedCommit: allowed,
    defaultBranch: {
      identity: "remote-v1",
      remote: "origin",
      remote_url: remoteUrl,
      ref: "refs/remotes/origin/main",
      commit: current,
    },
  });
  const found = discoverRepositoryCapabilities(root, signed.options);
  assert.notEqual(found.policy.provenance, "authenticated");
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(remoteRoot, { recursive: true, force: true });
});

function snapshot(root) {
  const out = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const file = path.join(dir, name);
      const stat = fs.lstatSync(file);
      out.push([path.relative(root, file), stat.size, stat.mtimeMs]);
      if (stat.isDirectory()) walk(file);
    }
  };
  walk(root);
  return out;
}

function cryptoHash(bytes) {
  return require("node:crypto").createHash("sha256").update(bytes).digest("hex");
}

function signDiscovery(receipt, key) {
  const material = { ...receipt };
  delete material.authentication;
  return { ...material, authentication: keyedIdentity(material, key) };
}

function signedOptions(root, fields = {}) {
  const key = fields.key || Buffer.alloc(32, 6);
  const now = fields.now || new Date("2026-08-10T00:00:00.000Z");
  const protectedCommit = fields.protectedCommit || "b".repeat(40);
  const defaultRef = fields.defaultRef || "refs/remotes/origin/main";
  const receipt = signDiscovery(
    {
      schema_version: 1,
      kind: "repository-discovery-v1",
      identity: fields.identity || "discovery-v1",
      repository_root: fs.realpathSync(root),
      repository_head: fields.repositoryHead || "a".repeat(40),
      protected_commit: protectedCommit,
      expected_default_ref: defaultRef,
      observed_at: (fields.observedAt || now).toISOString(),
      default_branch: fields.defaultBranch || {
        identity: "remote-v1",
        remote: "origin",
        remote_url: "/authenticated/origin.git",
        ref: defaultRef,
        commit: protectedCommit,
      },
      lefthook: fields.lefthook,
      github: fields.github,
    },
    key
  );
  return {
    receipt,
    options: {
      discoveryReceipt: receipt,
      expectedDiscoveryIdentity: receipt.identity,
      expectedProtectedCommit: protectedCommit,
      expectedDefaultRef: defaultRef,
      receiptKey: key,
      now,
      resolveRepositoryHead: () => receipt.repository_head,
    },
  };
}
