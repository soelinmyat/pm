"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { discoverRepositoryCapabilities } = require("../scripts/lib/repository-capabilities");

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
  const found = discoverRepositoryCapabilities(root, { protectedRoot: root });
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
  const found = discoverRepositoryCapabilities(root, {
    lefthookDump: {
      "pre-push": { commands: { mobile: { glob: "apps/mobile/**", run: "pnpm mobile" } } },
    },
    lefthookVersion: "1.12.3",
  });
  assert.equal(found.lefthook.commands.mobile.run, "pnpm mobile");
  assert.equal(found.lefthook.manager_version, "1.12.3");
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

test("candidate policy cannot replace protected authority", () => {
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
  assert.equal(
    discoverRepositoryCapabilities(root, { protectedRoot }).policy.candidate_push.permitted,
    false
  );
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(protectedRoot, { recursive: true, force: true });
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
