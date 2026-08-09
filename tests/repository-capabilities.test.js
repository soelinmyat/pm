"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");
const { discoverRepositoryCapabilities } = require("../scripts/lib/repository-capabilities");
const { digest } = require("../scripts/lib/repository-gate-plan-schema");

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
      candidate_push: { permitted: true, candidate_commands: ["mobile"], skipped_commands: [] },
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
  assert.equal(found.hooks.pre_push.exists, true);
  assert.deepEqual(snapshot(root), before);
  fs.rmSync(root, { recursive: true, force: true });
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
  const found = discoverRepositoryCapabilities(root, {
    lefthookReceipt: {
      authenticated: true,
      identity: "manager-receipt-v1",
      manager: managerIdentity,
      dump: lefthookDump,
      dump_digest: digest(lefthookDump),
    },
    expectedManagerIdentity: "manager-receipt-v1",
  });
  assert.equal(found.lefthook.commands.mobile.run, "pnpm mobile");
  assert.equal(found.lefthook.manager_version, "1.12.3");
  assert.equal(
    discoverRepositoryCapabilities(root, {
      lefthookReceipt: {
        authenticated: true,
        identity: "self-labeled",
        manager: managerIdentity,
        dump: lefthookDump,
        dump_digest: digest(lefthookDump),
      },
    }).lefthook.supported,
    false
  );
  fs.appendFileSync(manager, "# drift\n");
  assert.equal(
    discoverRepositoryCapabilities(root, {
      lefthookReceipt: {
        authenticated: true,
        identity: "manager-receipt-v1",
        manager: managerIdentity,
        dump: lefthookDump,
        dump_digest: digest(lefthookDump),
      },
      expectedManagerIdentity: "manager-receipt-v1",
    }).lefthook.supported,
    false
  );
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
      candidate_push: { permitted: true, candidate_commands: ["x"], skipped_commands: [] },
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
    JSON.stringify({ schema_version: 1, candidate_push: { permitted: true } })
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
    JSON.stringify({ schema_version: 1, candidate_push: { permitted: true } })
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
  const remoteCommit = git(["rev-parse", "refs/remotes/origin/main"]).stdout.trim();
  const authenticated = discoverRepositoryCapabilities(root, {
    protectedCommit: commit,
    expectedProtectedCommit: commit,
    defaultBranchReceipt: {
      authenticated: true,
      identity: "remote-main-v1",
      remote: "origin",
      remote_url: remoteRoot,
      ref: "refs/remotes/origin/main",
      commit: remoteCommit,
    },
    expectedDefaultRef: "refs/remotes/origin/main",
    expectedRemoteIdentity: "remote-main-v1",
  });
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

test("GitHub optimization facts require an externally bound authenticated receipt", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-github-cap-"));
  const absent = discoverRepositoryCapabilities(root);
  assert.equal(absent.github_capabilities.available, false);
  const facts = {
    branch_protection: true,
    required_checks: true,
    merge_queue: false,
  };
  const authenticated = discoverRepositoryCapabilities(root, {
    githubReceipt: { authenticated: true, identity: "github-v1", facts },
    expectedGithubIdentity: "github-v1",
  });
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
