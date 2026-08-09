"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const {
  buildDeliveryPlan,
  verifyPlanDigest,
  discoveryOptions,
  parseGitPathOutput,
} = require("../scripts/repository-delivery-plan");
const { digest } = require("../scripts/lib/repository-gate-plan-schema");
const { verifyEnvironment, keyedIdentity } = require("../scripts/repository-environment-preflight");
const { runRepositoryGates } = require("../scripts/repository-gate-runner");
const OLD_SHA = "a".repeat(40);
const NEW_SHA = "b".repeat(40);

test("NUL-delimited Git path output preserves Unicode and embedded newlines", () => {
  assert.deepEqual(parseGitPathOutput(Buffer.from("apps/日本語.ts\0apps/line\nbreak.ts\0")), [
    "apps/日本語.ts",
    "apps/line\nbreak.ts",
  ]);
});

test("delivery planning compiles each unique command glob only once", () => {
  let compilations = 0;
  buildDeliveryPlan({
    root: "/repo",
    changedPaths: Array.from({ length: 20 }, (_, index) => `apps/mobile/${index}.ts`),
    commands: { mobile: { glob: ["apps/mobile/**", "apps/shared/**"], exclude: "**/*.snap" } },
    capabilities: {},
    refUpdates: [`refs/heads/x ${OLD_SHA} refs/heads/x ${NEW_SHA}`],
    compileGlob: (glob) => {
      compilations++;
      return new RegExp(glob === "apps/mobile/**" ? "^apps/mobile/" : "a^");
    },
  });
  assert.equal(compilations, 3);
});

const commands = {
  "mobile-quality": { glob: "apps/mobile/**/*.{ts,tsx}", run: "pnpm --filter mobile test" },
  "shared-checks": { glob: "{apps/mobile,packages/shared}/**/*.{ts,tsx}", run: "pnpm shared" },
  "api-full": { glob: "apps/api/**", run: "bundle exec rails test" },
};

test("mobile-only selects mobile and shared but excludes API", () => {
  const plan = buildDeliveryPlan({
    root: "/repo",
    changedPaths: ["apps/mobile/src/a.tsx"],
    commands,
    capabilities: {
      identity: "cap",
      github_capabilities: { available: true, identity: "github-v1" },
      lefthook: { supported: true, identity: "manager-v1", dump_digest: "dump-v1" },
      policy: {
        candidate_push: {
          permitted: true,
          candidate_commands: ["mobile-quality", "shared-checks"],
          skipped_commands: [],
          command_identity: digest(commands),
        },
        source: {
          commit: NEW_SHA,
          path: ".pm/repository-delivery-policy.json",
          sha256: "sha256:" + "9".repeat(64),
        },
        delivery_bypass: {
          permitted_purposes: ["candidate-hook-bypass"],
          hook_bypass: "LEFTHOOK=0",
          signer_identity: "sha256:" + "8".repeat(64),
        },
        provenance: "authenticated",
      },
    },
    remote: "origin",
    remoteUrl: "git@example/x",
    refUpdates: [`refs/heads/x ${OLD_SHA} refs/heads/x ${NEW_SHA}`],
    environmentIdentity: { runtimes: [], path_digest: "x" },
  });
  assert.deepEqual(plan.targeted_commands, ["mobile-quality", "shared-checks"]);
  assert.equal(plan.targeted_commands.includes("api-full"), false);
  assert.equal(plan.complete_commands.includes("api-full"), false);
  assert.equal(plan.candidate_push.permitted, true);
  assert.equal(plan.repository_policy.source.commit, NEW_SHA);
  assert.deepEqual(plan.repository_policy.delivery_bypass.permitted_purposes, [
    "candidate-hook-bypass",
  ]);
  assert.equal(plan.adapter.supported, true);
  assert.equal(plan.merge_base_commit, null);
  assert.deepEqual(plan.environment_identity, { runtimes: [], path_digest: "x" });
  assert.equal(verifyPlanDigest(plan), true);
});

test("production planner CLI rejects incomplete remote, ref-update, and environment inputs", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-delivery-cli-"));
  const git = (args) =>
    childProcess.spawnSync("git", args, { cwd: root, encoding: "utf8", shell: false });
  git(["init"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Test"]);
  fs.writeFileSync(path.join(root, "README.md"), "fixture\n");
  git(["add", "README.md"]);
  git(["commit", "-m", "fixture"]);
  const base = git(["rev-parse", "HEAD"]).stdout.trim();
  const cli = childProcess.spawnSync(
    process.execPath,
    [
      path.join(__dirname, "../scripts/repository-delivery-plan.js"),
      "--root",
      root,
      "--base",
      base,
    ],
    { encoding: "utf8", shell: false }
  );
  assert.notEqual(cli.status, 0);
  assert.match(cli.stderr, /remote|ref-update|environment/i);
  fs.rmSync(root, { recursive: true, force: true });
});

test("production planner CLI accepts only hash-bound complete execution inputs", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-delivery-cli-complete-"));
  const remoteRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pm-delivery-remote-"));
  const managerRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pm-delivery-manager-"));
  const git = (args) =>
    childProcess.spawnSync("git", args, { cwd: root, encoding: "utf8", shell: false });
  git(["init"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Test"]);
  fs.mkdirSync(path.join(root, ".pm"));
  fs.mkdirSync(path.join(root, "apps/mobile"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".pm/repository-delivery-policy.json"),
    JSON.stringify({
      schema_version: 1,
      candidate_push: {
        permitted: true,
        candidate_commands: ["mobile"],
        skipped_commands: [],
        command_identity: digest({
          mobile: { glob: "apps/mobile/**", run: "pnpm mobile", exclude: null },
        }),
      },
    })
  );
  fs.writeFileSync(path.join(root, "apps/mobile/a.ts"), "one\n");
  fs.writeFileSync(path.join(root, ".nvmrc"), `${process.version.slice(1)}\n`);
  fs.writeFileSync(path.join(root, ".git/hooks/pre-push"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  git(["add", ".pm/repository-delivery-policy.json", "apps/mobile/a.ts", ".nvmrc"]);
  git(["commit", "-m", "protected base"]);
  const base = git(["rev-parse", "HEAD"]).stdout.trim();
  childProcess.spawnSync("git", ["init", "--bare", remoteRoot], { encoding: "utf8", shell: false });
  git(["remote", "add", "origin", remoteRoot]);
  git(["push", "origin", "HEAD:main"]);
  const remoteUrl = git(["remote", "get-url", "--push", "origin"]).stdout.trim();
  fs.writeFileSync(path.join(root, "apps/mobile/a.ts"), "two\n");
  git(["add", "apps/mobile/a.ts"]);
  git(["commit", "-m", "candidate"]);
  const head = git(["rev-parse", "HEAD"]).stdout.trim();
  const dump = {
    "pre-push": { commands: { mobile: { glob: "apps/mobile/**", run: "pnpm mobile" } } },
  };
  const manager = path.join(managerRoot, "lefthook");
  fs.writeFileSync(
    manager,
    `#!/bin/sh\nif [ "$1" = "version" ]; then printf '1.12.3\\n'; else printf '%s\\n' '${JSON.stringify(dump)}'; fi\n`,
    { mode: 0o700 }
  );
  const managerBytes = fs.readFileSync(manager);
  const receiptKey = "machine-local-receipt-key-32bytes!!";
  const discoveryMaterial = {
    schema_version: 1,
    kind: "repository-discovery-v1",
    identity: "discovery-v1",
    repository_root: fs.realpathSync(root),
    repository_head: head,
    protected_commit: base,
    expected_protected_commit: base,
    expected_default_ref: "refs/remotes/origin/main",
    observed_at: new Date().toISOString(),
    default_branch: {
      identity: "remote-v1",
      remote: "origin",
      remote_url: remoteUrl,
      ref: "refs/remotes/origin/main",
      commit: base,
    },
    lefthook: {
      identity: "manager-v1",
      manager: {
        path: manager,
        realpath: fs.realpathSync(manager),
        sha256: sha(managerBytes),
        version: "1.12.3",
      },
      dump,
      dump_digest: digest(dump),
      hook_contract: { kind: "direct-manager-pre-push-v1" },
      manager_environment: { PATH: process.env.PATH },
    },
    github: {
      identity: "github-v1",
      facts: { branch_protection: true, required_checks: true, merge_queue: false },
    },
  };
  const discovery = {
    ...discoveryMaterial,
    authentication: keyedIdentity(discoveryMaterial, receiptKey),
  };
  const inputs = path.join(root, ".pm", "inputs");
  fs.mkdirSync(inputs);
  const discoveryFile = writeAuthenticatedJson(inputs, "discovery.json", discovery);
  const sourceRef = git(["symbolic-ref", "--quiet", "HEAD"]).stdout.trim();
  const refsFile = writeAuthenticatedJson(inputs, "refs.json", [
    `${sourceRef} ${head} ${sourceRef} ${base}`,
  ]);
  const preflight = verifyEnvironment({
    expectations: {
      runtimes: [
        {
          name: "node",
          constraint: process.version.slice(1),
          source: ".nvmrc",
          scope: "local",
        },
      ],
      probes: [],
    },
  });
  assert.equal(preflight.status, "verified");
  const environment = preflight.identity;
  const environmentFile = writeAuthenticatedJson(inputs, "environment.json", preflight);
  const cliArgs = [
    path.join(__dirname, "../scripts/repository-delivery-plan.js"),
    "--root",
    root,
    "--base",
    base,
    "--head",
    head,
    "--remote",
    "origin",
    "--remote-url",
    remoteUrl,
    "--ref-updates",
    path.relative(root, refsFile.path),
    "--ref-updates-sha256",
    refsFile.sha256,
    "--environment-identity",
    path.relative(root, environmentFile.path),
    "--environment-identity-sha256",
    environmentFile.sha256,
    "--discovery-receipt",
    path.relative(root, discoveryFile.path),
    "--discovery-receipt-sha256",
    discoveryFile.sha256,
  ];
  const unauthenticated = childProcess.spawnSync(process.execPath, cliArgs, {
    encoding: "utf8",
    shell: false,
    env: { ...process.env, PM_REPOSITORY_RECEIPT_KEY: "" },
  });
  assert.notEqual(unauthenticated.status, 0);
  assert.match(unauthenticated.stderr, /REPOSITORY_RECEIPT_KEY/);
  const cli = childProcess.spawnSync(process.execPath, cliArgs, {
    encoding: "utf8",
    shell: false,
    env: { ...process.env, PM_REPOSITORY_RECEIPT_KEY: receiptKey },
  });
  assert.equal(cli.status, 0, cli.stderr);
  const plan = JSON.parse(cli.stdout);
  assert.equal(plan.adapter.supported, true);
  assert.equal(plan.merge_base_commit, base);
  assert.equal(plan.remote.name, "origin");
  assert.equal(plan.remote.stdin, `${refsFile.value[0]}\n`);
  assert.deepEqual(plan.environment_identity, environment);
  const executed = runRepositoryGates(plan, "targeted", {
    expectedPlanDigest: plan.plan_digest,
    expectedCapabilityIdentity: plan.capability_identity,
    capabilityDiscovery: discoveryOptions(discovery, {
      receiptKey,
      expectedProtectedCommit: base,
      expectedDefaultRef: discovery.expected_default_ref,
    }),
  });
  assert.equal(executed.status, "passed", JSON.stringify(executed));
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(remoteRoot, { recursive: true, force: true });
  fs.rmSync(managerRoot, { recursive: true, force: true });
});

test("candidate permission requires protected policy coverage of every skipped command", () => {
  const plan = buildDeliveryPlan({
    root: "/repo",
    changedPaths: ["apps/mobile/src/a.tsx"],
    commands: {
      ...commands,
      "mobile-final": { glob: "apps/mobile/**", run: "pnpm final", candidate: false },
    },
    capabilities: {
      identity: "cap",
      policy: {
        candidate_push: { permitted: true, skipped_commands: [] },
        provenance: "candidate",
      },
    },
  });
  assert.equal(plan.candidate_push.permitted, false);
});

test("unavailable authenticated GitHub capabilities force comprehensive planning", () => {
  const plan = buildDeliveryPlan({
    root: "/repo",
    changedPaths: ["apps/mobile/src/a.tsx"],
    commands,
    capabilities: { identity: "cap", lefthook: { supported: true } },
  });
  assert.equal(plan.adapter.supported, false);
});

test("protected policy must name every command skipped during candidate publication", () => {
  const withFinal = {
    ...commands,
    "mobile-final": { glob: "apps/mobile/**", run: "pnpm final", candidate: false },
  };
  const denied = buildDeliveryPlan({
    root: "/repo",
    changedPaths: ["apps/mobile/a.ts"],
    commands: withFinal,
    capabilities: {
      identity: "x",
      policy: {
        provenance: "authenticated",
        candidate_push: {
          permitted: true,
          candidate_commands: ["mobile-quality", "shared-checks"],
          skipped_commands: [],
        },
      },
    },
  });
  assert.equal(denied.candidate_push.permitted, false);
  const allowed = buildDeliveryPlan({
    root: "/repo",
    changedPaths: ["apps/mobile/a.ts"],
    commands: withFinal,
    capabilities: {
      identity: "x",
      policy: {
        provenance: "authenticated",
        candidate_push: {
          permitted: true,
          candidate_commands: ["mobile-quality", "shared-checks"],
          skipped_commands: ["mobile-final"],
          command_identity: digest(withFinal),
        },
      },
    },
  });
  assert.equal(allowed.candidate_push.permitted, true);
});

test("protected policy command identity must cover the complete live gate manifest", () => {
  const protectedCommands = {
    fast: { glob: "apps/mobile/**", run: "pnpm fast" },
    slow: { glob: "apps/mobile/**", run: "pnpm slow" },
  };
  const policy = {
    provenance: "authenticated",
    candidate_push: {
      permitted: true,
      candidate_commands: ["fast", "slow"],
      skipped_commands: [],
      command_identity: digest(protectedCommands),
    },
  };
  const complete = buildDeliveryPlan({
    root: "/repo",
    changedPaths: ["apps/mobile/a.ts"],
    commands: protectedCommands,
    capabilities: { identity: "x", policy },
  });
  assert.equal(complete.candidate_push.permitted, true);

  const missing = buildDeliveryPlan({
    root: "/repo",
    changedPaths: ["apps/mobile/a.ts"],
    commands: { fast: protectedCommands.fast },
    capabilities: { identity: "x", policy },
  });
  assert.equal(missing.candidate_push.permitted, false);
});

test("rejects malformed Git remote and exact four-field ref-update protocol", () => {
  const base = {
    root: "/repo",
    changedPaths: ["apps/mobile/a.ts"],
    commands,
    capabilities: { identity: "cap" },
    remote: "origin",
    remoteUrl: "git@example/x",
  };
  for (const refUpdates of [
    [`refs/heads/x ${OLD_SHA} refs/heads/x`],
    [`refs/heads/x short refs/heads/x ${NEW_SHA}`],
    [`refs/heads/x ${OLD_SHA} refs/heads/x ${NEW_SHA}\nINJECT`],
    [`bad-ref ${OLD_SHA} refs/heads/x ${NEW_SHA}`],
  ])
    assert.throws(() => buildDeliveryPlan({ ...base, refUpdates }), /ref|sha|Git/i);
  assert.throws(
    () => buildDeliveryPlan({ ...base, remote: "origin\n--upload-pack=x", refUpdates: [] }),
    /remote/i
  );
  assert.throws(
    () => buildDeliveryPlan({ ...base, remoteUrl: "git@example/x\nmalformed", refUpdates: [] }),
    /remote/i
  );
});

test("relevant identities alter plan digest", () => {
  const a = buildDeliveryPlan({
    root: "/repo",
    changedPaths: ["apps/mobile/src/a.tsx"],
    commands,
    capabilities: { identity: "a" },
  });
  const b = buildDeliveryPlan({
    root: "/repo",
    changedPaths: ["apps/mobile/src/a.tsx"],
    commands,
    capabilities: { identity: "b" },
  });
  assert.notEqual(a.plan_digest, b.plan_digest);
});

function sha(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function writeAuthenticatedJson(dir, name, value) {
  const file = path.join(dir, name);
  const bytes = Buffer.from(JSON.stringify(value));
  fs.writeFileSync(file, bytes);
  return { path: file, sha256: sha(bytes), value };
}
