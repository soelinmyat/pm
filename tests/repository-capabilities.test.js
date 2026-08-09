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
  const lefthookDump = {
    "pre-push": { commands: { mobile: { glob: "apps/mobile/**", run: "pnpm mobile" } } },
  };
  const found = discoverRepositoryCapabilities(root, {
    lefthookDump,
    lefthookVersion: "1.12.3",
    lefthookAuthenticated: true,
    expectedLefthookDumpDigest: digest(lefthookDump),
  });
  assert.equal(found.lefthook.commands.mobile.run, "pnpm mobile");
  assert.equal(found.lefthook.manager_version, "1.12.3");
  assert.equal(
    discoverRepositoryCapabilities(root, {
      lefthookDump,
      lefthookAuthenticated: true,
    }).lefthook.supported,
    false
  );
  fs.rmSync(root, { recursive: true, force: true });
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
  const found = discoverRepositoryCapabilities(root, { protectedCommit: commit });
  assert.equal(found.policy.provenance, "authenticated");
  assert.equal(found.policy.candidate_push.permitted, false);
  assert.match(found.policy.authority, new RegExp(commit));
  fs.rmSync(root, { recursive: true, force: true });
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
  const found = discoverRepositoryCapabilities(root, {
    lefthookAuthenticated: true,
    lefthookDump,
    expectedLefthookDumpDigest: digest(lefthookDump),
  });
  assert.equal(found.lefthook.supported, false);
  assert.ok(found.lefthook.issues.length >= 2);
  assert.deepEqual(found.lefthook.commands, {});
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
