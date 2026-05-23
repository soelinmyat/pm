"use strict";

// End-to-end regression for the worktree-fragmentation bug:
//
// Before this fix, pm-log writers composed `.pm/analytics/...` from
// `projectRoot`, where projectRoot was the cwd's git toplevel. When a flow
// ran inside a worktree, that resolved to the worktree itself — creating a
// per-worktree `.pm/analytics/` tree and silently fragmenting telemetry.
//
// These tests build a real two-repo + worktree layout on disk, invoke pm-log
// from inside the worktree, and assert the row landed in the storage repo
// (kb) — not in the worktree.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const PM_LOG = path.join(ROOT, "scripts", "pm-log.sh");

function cleanGitEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_OBJECT_DIRECTORY;
  delete env.GIT_ALTERNATE_OBJECT_DIRECTORIES;
  return env;
}

function git(cwd, args, env) {
  childProcess.execFileSync("git", args, { cwd, env, stdio: "ignore" });
}

function setupTwoRepoLayout({ flatConfig = false, hostIdInConfig = null } = {}) {
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pm-wt-test-")));
  const repo = path.join(parent, "mono");
  const kb = path.join(parent, "kb");
  fs.mkdirSync(repo);
  fs.mkdirSync(kb);

  const env = cleanGitEnv({ PM_HOST_ID: "test-host" });

  // Initialize both repos so git rev-parse works inside the worktree.
  for (const dir of [repo, kb]) {
    git(dir, ["init", "-b", "main"], env);
    git(dir, ["config", "user.email", "pm@example.com"], env);
    git(dir, ["config", "user.name", "PM Test"], env);
    fs.writeFileSync(path.join(dir, "README.md"), "# placeholder\n");
    git(dir, ["add", "README.md"], env);
    git(dir, ["commit", "-m", "init"], env);
  }

  // Enable analytics for the mono repo. Commit so worktrees inherit the flag.
  fs.mkdirSync(path.join(repo, ".claude"));
  fs.writeFileSync(path.join(repo, ".claude", "pm.local.md"), "---\nanalytics: true\n---\n");

  // Write the config in either flat or nested form. Flat (pm.config.json) is
  // committed because that's how real projects use it. Nested (.pm/config.json)
  // is left untracked because `.pm/` is gitignored in real projects.
  const config = {
    config_schema: 2,
    pm_repo: { type: "local", path: flatConfig ? "../kb" : "../../kb" },
  };
  if (hostIdInConfig) config.host_id = hostIdInConfig;

  if (flatConfig) {
    fs.writeFileSync(path.join(repo, "pm.config.json"), JSON.stringify(config));
    git(repo, ["add", "pm.config.json", ".claude/pm.local.md"], env);
  } else {
    fs.mkdirSync(path.join(repo, ".pm"));
    fs.writeFileSync(path.join(repo, ".pm", "config.json"), JSON.stringify(config));
    git(repo, ["add", ".claude/pm.local.md"], env);
  }
  git(repo, ["commit", "-m", "enable analytics + config"], env);

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

function readJsonLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function addWorktree(repo, worktreePath, branch, env) {
  git(repo, ["worktree", "add", "-b", branch, worktreePath], env);
}

test("worktree: pm-log from inside a worktree writes to kb, not the worktree", () => {
  const { repo, kb, env, cleanup } = setupTwoRepoLayout({ flatConfig: false });
  try {
    const worktree = path.join(path.dirname(repo), "wt");
    addWorktree(repo, worktree, "feature/test", env);

    childProcess.execFileSync(
      PM_LOG,
      ["activity", "--skill", "dev", "--event", "invoked", "--detail", "from-worktree"],
      { cwd: worktree, env, stdio: "ignore" }
    );

    // Storage path: kb/.pm/analytics/activity-test-host.jsonl
    const kbActivity = path.join(kb, ".pm", "analytics", "activity-test-host.jsonl");
    assert.ok(fs.existsSync(kbActivity), "kb should contain the activity row");
    const rows = readJsonLines(kbActivity);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].skill, "dev");
    assert.equal(rows[0].event, "invoked");
    assert.equal(rows[0].detail, "from-worktree");
    assert.equal(rows[0].host_id, "test-host");

    // Critical: the worktree must NOT have grown its own .pm/analytics tree.
    assert.equal(
      fs.existsSync(path.join(worktree, ".pm", "analytics")),
      false,
      "worktree must not contain an analytics directory"
    );
  } finally {
    cleanup();
  }
});

test("worktree: flat pm.config.json — pm-log from worktree still routes to kb", () => {
  const { repo, kb, env, cleanup } = setupTwoRepoLayout({ flatConfig: true });
  try {
    const worktree = path.join(path.dirname(repo), "wt2");
    addWorktree(repo, worktree, "feature/flat", env);

    childProcess.execFileSync(PM_LOG, ["activity", "--skill", "groom", "--event", "started"], {
      cwd: worktree,
      env,
      stdio: "ignore",
    });

    const kbActivity = path.join(kb, ".pm", "analytics", "activity-test-host.jsonl");
    assert.ok(fs.existsSync(kbActivity));
    const rows = readJsonLines(kbActivity);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].skill, "groom");

    // Repo should not have grown a .pm/ directory just to write analytics.
    assert.equal(
      fs.existsSync(path.join(repo, ".pm")),
      false,
      "flat-config repo must remain free of a .pm/ directory"
    );
    assert.equal(fs.existsSync(path.join(worktree, ".pm")), false);
  } finally {
    cleanup();
  }
});

test("worktree: no config at all → falls back to projectRoot/.pm (back-compat)", () => {
  // Bare repo with no pm.config.json or .pm/config.json. Writer should fall
  // back to writing in the worktree's local .pm/ — same as today's behavior
  // for uninitialized projects.
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pm-wt-noconfig-")));
  const repo = path.join(parent, "mono");
  fs.mkdirSync(repo);
  const env = cleanGitEnv({ PM_HOST_ID: "test-host" });
  git(repo, ["init", "-b", "main"], env);
  git(repo, ["config", "user.email", "pm@example.com"], env);
  git(repo, ["config", "user.name", "PM Test"], env);
  fs.writeFileSync(path.join(repo, "README.md"), "x\n");
  git(repo, ["add", "README.md"], env);
  git(repo, ["commit", "-m", "init"], env);
  fs.mkdirSync(path.join(repo, ".claude"));
  fs.writeFileSync(path.join(repo, ".claude", "pm.local.md"), "---\nanalytics: true\n---\n");

  try {
    childProcess.execFileSync(PM_LOG, ["activity", "--skill", "test", "--event", "invoked"], {
      cwd: repo,
      env,
      stdio: "ignore",
    });
    const localActivity = path.join(repo, ".pm", "analytics", "activity-test-host.jsonl");
    assert.ok(fs.existsSync(localActivity), "fallback writer should target projectRoot/.pm/");
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("host_id: env var takes precedence over config and hostname", () => {
  const { repo, kb, env, cleanup } = setupTwoRepoLayout({
    flatConfig: true,
    hostIdInConfig: "config-host",
  });
  try {
    // env override should win
    const envWithOverride = { ...env, PM_HOST_ID: "env-override" };
    childProcess.execFileSync(PM_LOG, ["activity", "--skill", "x", "--event", "y"], {
      cwd: repo,
      env: envWithOverride,
      stdio: "ignore",
    });
    const envFile = path.join(kb, ".pm", "analytics", "activity-env-override.jsonl");
    assert.ok(fs.existsSync(envFile), "env PM_HOST_ID should drive the filename");
    const rows = readJsonLines(envFile);
    assert.equal(rows[0].host_id, "env-override");
  } finally {
    cleanup();
  }
});

test("host_id: pm.config.json.host_id used when env not set", () => {
  const { repo, kb, env, cleanup } = setupTwoRepoLayout({
    flatConfig: true,
    hostIdInConfig: "config-host",
  });
  try {
    // Strip PM_HOST_ID so config wins
    const envNoOverride = { ...env };
    delete envNoOverride.PM_HOST_ID;
    childProcess.execFileSync(PM_LOG, ["activity", "--skill", "x", "--event", "y"], {
      cwd: repo,
      env: envNoOverride,
      stdio: "ignore",
    });
    const configFile = path.join(kb, ".pm", "analytics", "activity-config-host.jsonl");
    assert.ok(fs.existsSync(configFile), "config host_id should drive the filename");
    const rows = readJsonLines(configFile);
    assert.equal(rows[0].host_id, "config-host");
  } finally {
    cleanup();
  }
});

test("host_id: sanitized hostname is filename-safe", () => {
  // Unicode and shell metachars in hostname → must end up filename-safe.
  const { repo, kb, env, cleanup } = setupTwoRepoLayout({ flatConfig: true });
  try {
    const envOverride = { ...env, PM_HOST_ID: "soes mbp/at home.local!" };
    childProcess.execFileSync(PM_LOG, ["activity", "--skill", "x", "--event", "y"], {
      cwd: repo,
      env: envOverride,
      stdio: "ignore",
    });
    const analyticsDir = path.join(kb, ".pm", "analytics");
    const files = fs.readdirSync(analyticsDir).filter((f) => f.startsWith("activity-"));
    assert.equal(files.length, 1);
    assert.match(files[0], /^activity-[A-Za-z0-9._-]+\.jsonl$/);
    assert.doesNotMatch(files[0], /[\s\/!]/);
  } finally {
    cleanup();
  }
});

test("multi-host: two writers with different host_ids produce two separate files", () => {
  const { repo, kb, env, cleanup } = setupTwoRepoLayout({ flatConfig: true });
  try {
    for (const host of ["alpha", "beta"]) {
      childProcess.execFileSync(PM_LOG, ["activity", "--skill", "dev", "--event", "invoked"], {
        cwd: repo,
        env: { ...env, PM_HOST_ID: host },
        stdio: "ignore",
      });
    }
    const dir = path.join(kb, ".pm", "analytics");
    const files = fs.readdirSync(dir).sort();
    assert.deepEqual(files, ["activity-alpha.jsonl", "activity-beta.jsonl"]);
    assert.equal(readJsonLines(path.join(dir, "activity-alpha.jsonl")).length, 1);
    assert.equal(readJsonLines(path.join(dir, "activity-beta.jsonl")).length, 1);
  } finally {
    cleanup();
  }
});
