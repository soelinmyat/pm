"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  buildPrompt,
  countRunsToday,
  engineCommand,
  runWorker,
} = require("../scripts/loop-worker.js");

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
  const loopConfig = {
    autonomy: { start_dev: autonomyStartDev },
    worker: { keep_workspace: true },
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

  return {
    root,
    project,
    pmDir,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
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
      '  console.log("fake engine done");',
      `  process.exit(${exitCode});`,
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

  const claude = engineCommand({ default_runtime: "codex", worker: { engine: "claude" } }, "p");
  assert.equal(claude.bin, "claude");
  assert.ok(claude.args.includes("-p"));

  const custom = engineCommand(
    { default_runtime: "codex", worker: { engine_bin: "/x/bin", engine_args: ["--a"] } },
    "p"
  );
  assert.equal(custom.bin, "/x/bin");
  assert.deepEqual(custom.args, ["--a"]);
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

test("worker executes the engine in a bootstrapped worktree and releases the lease", () => {
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
            bootstrap_files: ["local.env"],
            keep_workspace: true,
          },
        },
        null,
        2
      )
    );
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

    // Lease released (file gone) and the release was pushed
    assert.equal(fs.readdirSync(path.join(fixture.pmDir, "loop", "leases")).length, 0);

    // Crash-safe ledger records the completed run
    const ledger = JSON.parse(fs.readFileSync(result.ledger, "utf8"));
    assert.equal(ledger.status, "completed");
    assert.equal(ledger.exit_code, 0);
    assert.ok(ledger.lease_release.released);
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
    git(["add", "-A"], fixture.project);
    git(["commit", "-m", "config"], fixture.project);
    git(["push"], fixture.project);

    const result = runWorker(fixture.project, { pmDir: fixture.pmDir });
    assert.equal(result.status, "failed");
    assert.equal(result.exit_code, 3);
    assert.equal(fs.readdirSync(path.join(fixture.pmDir, "loop", "leases")).length, 0);
    const ledger = JSON.parse(fs.readFileSync(result.ledger, "utf8"));
    assert.equal(ledger.status, "failed");
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

test("buildPrompt names the card and forbids merging", () => {
  const prompt = buildPrompt({
    selected: { id: "PM-9", title: "T", kind: "task", command: "/pm:dev PM-9" },
  });
  assert.match(prompt, /\/pm:dev PM-9/);
  assert.match(prompt, /do NOT merge/);
  assert.match(prompt, /never skip or self-approve a gate/);
});
