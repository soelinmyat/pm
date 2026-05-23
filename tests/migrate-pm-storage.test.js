"use strict";

// Tests for scripts/migrate-pm-storage.js — the one-shot script that folds
// legacy `.pm/analytics/{activity,steps}.jsonl` files (from the main repo and
// from per-worktree fragments) into the kb's per-host JSONL files.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const SCRIPT = path.join(ROOT, "scripts", "migrate-pm-storage.js");

function cleanGitEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  for (const key of [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  ]) {
    delete env[key];
  }
  return env;
}

function git(cwd, args, env) {
  childProcess.execFileSync("git", args, { cwd, env, stdio: "ignore" });
}

function writeJsonLines(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
}

function readJsonLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function setupLegacyLayout({ hostInRows = null } = {}) {
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pm-mig-")));
  const repo = path.join(parent, "mono");
  const kb = path.join(parent, "kb");
  fs.mkdirSync(repo);
  fs.mkdirSync(kb);
  const env = cleanGitEnv();

  for (const dir of [repo, kb]) {
    git(dir, ["init", "-b", "main"], env);
    git(dir, ["config", "user.email", "pm@example.com"], env);
    git(dir, ["config", "user.name", "PM Test"], env);
    fs.writeFileSync(path.join(dir, "README.md"), "# placeholder\n");
    git(dir, ["add", "README.md"], env);
    git(dir, ["commit", "-m", "init"], env);
  }

  // Flat pm.config.json pointing at kb sibling.
  fs.writeFileSync(
    path.join(repo, "pm.config.json"),
    JSON.stringify({ config_schema: 2, pm_repo: { type: "local", path: "../kb" } })
  );

  // Legacy main repo analytics (rows without host_id, simulating the bug era).
  const mainAnalytics = path.join(repo, ".pm", "analytics");
  const mainActivity = [
    { skill: "dev", event: "started", ts: "2026-05-01T10:00:00Z", branch: "main" },
    { skill: "dev", event: "completed", ts: "2026-05-01T10:05:00Z", branch: "main" },
  ];
  const mainSteps = [
    {
      run_id: "r1",
      skill: "dev",
      step: "plan",
      started_at: "2026-05-01T10:00:00Z",
      ended_at: "2026-05-01T10:02:00Z",
      branch: "main",
    },
  ];
  writeJsonLines(path.join(mainAnalytics, "activity.jsonl"), mainActivity);
  writeJsonLines(path.join(mainAnalytics, "steps.jsonl"), mainSteps);

  // Legacy worktree fragments.
  const wt1 = path.join(repo, ".claude", "worktrees", "alpha");
  const wt2 = path.join(repo, ".claude", "worktrees", "beta");
  writeJsonLines(path.join(wt1, ".pm", "analytics", "activity.jsonl"), [
    { skill: "groom", event: "started", ts: "2026-05-02T11:00:00Z", branch: "feature/a" },
  ]);
  writeJsonLines(path.join(wt1, ".pm", "analytics", "steps.jsonl"), [
    {
      run_id: "r2",
      skill: "groom",
      step: "research",
      started_at: "2026-05-02T11:00:00Z",
      ended_at: "2026-05-02T11:10:00Z",
      branch: "feature/a",
    },
    {
      run_id: "r2",
      skill: "groom",
      step: "propose",
      started_at: "2026-05-02T11:10:00Z",
      ended_at: "2026-05-02T11:20:00Z",
      branch: "feature/a",
    },
  ]);
  writeJsonLines(path.join(wt2, ".pm", "analytics", "activity.jsonl"), [
    { skill: "ship", event: "started", ts: "2026-05-03T12:00:00Z", branch: "feature/b" },
  ]);
  // No steps file in wt2 — that's a legitimate state.

  // If hostInRows is provided, sprinkle it onto a subset of rows so we can
  // verify those host_ids are preserved (not overwritten by the default).
  if (hostInRows) {
    mainActivity[0].host_id = hostInRows;
    writeJsonLines(path.join(mainAnalytics, "activity.jsonl"), mainActivity);
  }

  return {
    parent,
    repo,
    kb,
    env,
    cleanup() {
      fs.rmSync(parent, { recursive: true, force: true });
    },
  };
}

function runMigrate(args, env = process.env) {
  const result = childProcess.spawnSync("node", [SCRIPT, ...args], {
    env,
    encoding: "utf8",
  });
  return result;
}

test("migration: folds main repo + worktree fragments into kb per-host files", () => {
  const { repo, kb, cleanup } = setupLegacyLayout();
  try {
    const result = runMigrate(["--project-dir", repo, "--host-id", "host-a"]);
    assert.equal(result.status, 0, `script failed: ${result.stderr}`);

    const activityFile = path.join(kb, ".pm", "analytics", "activity-host-a.jsonl");
    const stepsFile = path.join(kb, ".pm", "analytics", "steps-host-a.jsonl");

    const activityRows = readJsonLines(activityFile);
    const stepsRows = readJsonLines(stepsFile);

    // 2 main + 1 wt1 + 1 wt2 = 4 activity rows
    assert.equal(activityRows.length, 4, "activity row count");
    // 1 main + 2 wt1 + 0 wt2 = 3 step rows
    assert.equal(stepsRows.length, 3, "step row count");

    // Every row should now carry host_id = host-a
    for (const row of activityRows) assert.equal(row.host_id, "host-a");
    for (const row of stepsRows) assert.equal(row.host_id, "host-a");

    // The original files must remain untouched (migration is non-destructive).
    assert.ok(fs.existsSync(path.join(repo, ".pm", "analytics", "activity.jsonl")));
    assert.ok(
      fs.existsSync(
        path.join(repo, ".claude", "worktrees", "alpha", ".pm", "analytics", "activity.jsonl")
      )
    );

    // Marker files should exist in each source dir.
    assert.ok(fs.existsSync(path.join(repo, ".pm", "analytics", ".migrated.json")));
    assert.ok(
      fs.existsSync(
        path.join(repo, ".claude", "worktrees", "alpha", ".pm", "analytics", ".migrated.json")
      )
    );
    assert.ok(
      fs.existsSync(
        path.join(repo, ".claude", "worktrees", "beta", ".pm", "analytics", ".migrated.json")
      )
    );
  } finally {
    cleanup();
  }
});

test("migration: --dry-run does not write target files or markers", () => {
  const { repo, kb, cleanup } = setupLegacyLayout();
  try {
    const result = runMigrate(["--project-dir", repo, "--host-id", "host-a", "--dry-run"]);
    assert.equal(result.status, 0);

    assert.equal(fs.existsSync(path.join(kb, ".pm", "analytics", "activity-host-a.jsonl")), false);
    assert.equal(fs.existsSync(path.join(repo, ".pm", "analytics", ".migrated.json")), false);
  } finally {
    cleanup();
  }
});

test("migration: re-running with marker present is a no-op without --force", () => {
  const { repo, kb, cleanup } = setupLegacyLayout();
  try {
    runMigrate(["--project-dir", repo, "--host-id", "host-a"]);
    const activityFile = path.join(kb, ".pm", "analytics", "activity-host-a.jsonl");
    const firstCount = readJsonLines(activityFile).length;

    const second = runMigrate(["--project-dir", repo, "--host-id", "host-a"]);
    assert.equal(second.status, 0);
    assert.equal(readJsonLines(activityFile).length, firstCount, "rows must not duplicate");
  } finally {
    cleanup();
  }
});

test("migration: --force re-applies and would duplicate (caller responsibility)", () => {
  // --force exists for testing the script itself or for recovery scenarios.
  // It explicitly does NOT dedup — the user must clear targets first if they
  // want a clean re-run. This test documents the contract.
  const { repo, kb, cleanup } = setupLegacyLayout();
  try {
    runMigrate(["--project-dir", repo, "--host-id", "host-a"]);
    const activityFile = path.join(kb, ".pm", "analytics", "activity-host-a.jsonl");
    const firstCount = readJsonLines(activityFile).length;

    const second = runMigrate(["--project-dir", repo, "--host-id", "host-a", "--force"]);
    assert.equal(second.status, 0);
    assert.equal(readJsonLines(activityFile).length, firstCount * 2);
  } finally {
    cleanup();
  }
});

test("migration: preserves existing host_id on rows that already have one", () => {
  const { repo, kb, cleanup } = setupLegacyLayout({ hostInRows: "older-host" });
  try {
    runMigrate(["--project-dir", repo, "--host-id", "host-a"]);
    const activityFile = path.join(kb, ".pm", "analytics", "activity-host-a.jsonl");
    const rows = readJsonLines(activityFile);
    const preserved = rows.filter((row) => row.host_id === "older-host");
    const assigned = rows.filter((row) => row.host_id === "host-a");
    assert.equal(preserved.length, 1, "row that came in with host_id must keep it");
    assert.equal(assigned.length, 3, "remaining rows must get the default host_id");
  } finally {
    cleanup();
  }
});

test("migration: empty project (no legacy dirs) exits 0 with no-op message", () => {
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pm-mig-empty-")));
  const repo = path.join(parent, "mono");
  const kb = path.join(parent, "kb");
  fs.mkdirSync(repo);
  fs.mkdirSync(kb);
  const env = cleanGitEnv();
  for (const dir of [repo, kb]) {
    git(dir, ["init", "-b", "main"], env);
    git(dir, ["config", "user.email", "p@e.com"], env);
    git(dir, ["config", "user.name", "p"], env);
    fs.writeFileSync(path.join(dir, "README.md"), "x\n");
    git(dir, ["add", "README.md"], env);
    git(dir, ["commit", "-m", "init"], env);
  }
  fs.writeFileSync(
    path.join(repo, "pm.config.json"),
    JSON.stringify({ config_schema: 2, pm_repo: { type: "local", path: "../kb" } })
  );

  try {
    const result = runMigrate(["--project-dir", repo, "--host-id", "host-a"]);
    assert.equal(result.status, 0);
    assert.match(result.stderr, /Nothing to migrate/);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("migration: --host-id is required-ish — falls back to PM_HOST_ID env then hostname", () => {
  const { repo, kb, cleanup } = setupLegacyLayout();
  try {
    const env = { ...process.env, PM_HOST_ID: "env-host" };
    const result = runMigrate(["--project-dir", repo], env);
    assert.equal(result.status, 0);
    assert.ok(fs.existsSync(path.join(kb, ".pm", "analytics", "activity-env-host.jsonl")));
  } finally {
    cleanup();
  }
});
