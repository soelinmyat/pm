"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { buildLoopBoard } = require("../scripts/loop-board.js");
const { DEFAULT_LOOP_CONFIG } = require("../scripts/loop-config.js");
const { runLoop, selectNextCard } = require("../scripts/loop-runner.js");

const FIXED_NOW = new Date("2026-06-23T00:00:00Z");
const GIT_ENV_KEYS_TO_CLEAR = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_PREFIX",
  "GIT_SUPER_PREFIX",
];

function createProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-loop-runner-"));
  const project = {
    root,
    pmDir: path.join(root, "pm"),
    write(relPath, content) {
      const fullPath = path.join(root, relPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content);
      return fullPath;
    },
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
  fs.mkdirSync(path.join(project.pmDir, "backlog"), { recursive: true });
  return project;
}

function fm(data) {
  const lines = ["---"];
  for (const [key, value] of Object.entries(data)) {
    lines.push(`${key}: ${value}`);
  }
  lines.push("---", "");
  return lines.join("\n");
}

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    env: cleanGitEnv(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function runGit(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    env: cleanGitEnv(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function cleanGitEnv(extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  for (const key of GIT_ENV_KEYS_TO_CLEAR) {
    delete env[key];
  }
  return env;
}

function initGit(project) {
  git(project.root, ["init"]);
  git(project.root, ["config", "user.name", "PM Test"]);
  git(project.root, ["config", "user.email", "pm-test@example.com"]);
  git(project.root, ["add", "pm/backlog"]);
  git(project.root, ["commit", "-m", "init"]);
}

function attachRemote(project, t) {
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), "pm-loop-remote-"));
  t.after(() => fs.rmSync(remote, { recursive: true, force: true }));
  runGit(["init", "--bare", remote], project.root);
  git(project.root, ["branch", "-M", "main"]);
  git(project.root, ["remote", "add", "origin", remote]);
  git(project.root, ["push", "-u", "origin", "main"]);
  runGit(["--git-dir", remote, "symbolic-ref", "HEAD", "refs/heads/main"], project.root);
  return remote;
}

function updateRemote(remote, mutate) {
  const clone = fs.mkdtempSync(path.join(os.tmpdir(), "pm-loop-clone-"));
  try {
    runGit(["clone", remote, clone], process.cwd());
    git(clone, ["config", "user.name", "PM Remote"]);
    git(clone, ["config", "user.email", "pm-remote@example.com"]);
    mutate(clone);
    git(clone, ["add", "pm/backlog"]);
    git(clone, ["commit", "-m", "remote update"]);
    git(clone, ["push"]);
  } finally {
    fs.rmSync(clone, { recursive: true, force: true });
  }
}

function config(overrides = {}) {
  return {
    ...DEFAULT_LOOP_CONFIG,
    autonomy: {
      ...DEFAULT_LOOP_CONFIG.autonomy,
      ...(overrides.autonomy || {}),
    },
    wip_limits: {
      ...DEFAULT_LOOP_CONFIG.wip_limits,
      ...(overrides.wip_limits || {}),
    },
    budgets: {
      ...DEFAULT_LOOP_CONFIG.budgets,
      ...(overrides.budgets || {}),
    },
  };
}

test("loop runner refuses real dev pickup unless autonomy.start_dev is enabled", (t) => {
  const project = createProject();
  t.after(project.cleanup);

  project.write(
    "pm/backlog/approved-task.md",
    fm({
      type: "backlog",
      id: "PM-001",
      title: "Approved task",
      kind: "task",
      status: "planned",
      implementation_approved: "true",
      approved_by: "soelinmyat",
      approved_at: "2026-06-23",
      updated: "2026-06-22",
    }) + "body"
  );

  const board = buildLoopBoard(project.root, { now: FIXED_NOW });
  const selected = selectNextCard(board, config(), { mode: "dev" });

  assert.equal(selected.card, null);
  assert.deepEqual(selected.skipped, [
    {
      id: "PM-001",
      column: "ready_for_dev",
      reason: "autonomy.start_dev disabled",
    },
  ]);
});

test("loop runner plans approved implementation when both gates are true", (t) => {
  const project = createProject();
  t.after(project.cleanup);

  project.write(
    "pm/backlog/approved-task.md",
    fm({
      type: "backlog",
      id: "PM-002",
      title: "Approved task",
      kind: "task",
      status: "planned",
      implementation_approved: "true",
      approved_by: "soelinmyat",
      approved_at: "2026-06-23",
      updated: "2026-06-22",
    }) + "body"
  );

  const result = runLoop(project.root, {
    now: FIXED_NOW,
    mode: "dev",
    dryRun: true,
    config: config({ autonomy: { start_dev: true } }),
  });

  assert.equal(result.status, "planned");
  assert.equal(result.mutation, false);
  assert.equal(result.selected.id, "PM-002");
  assert.equal(result.selected.command, "/pm:dev PM-002");
});

test("loop runner dry-run does not write events or leases", (t) => {
  const project = createProject();
  t.after(project.cleanup);

  project.write(
    "pm/backlog/approved-task.md",
    fm({
      type: "backlog",
      id: "PM-003",
      title: "Approved task",
      kind: "task",
      status: "planned",
      implementation_approved: "true",
      approved_by: "soelinmyat",
      approved_at: "2026-06-23",
      updated: "2026-06-22",
    }) + "body"
  );

  const result = runLoop(project.root, {
    now: FIXED_NOW,
    mode: "dev",
    dryRun: true,
    config: config({ autonomy: { start_dev: true } }),
  });

  assert.equal(result.status, "planned");
  assert.equal(fs.existsSync(path.join(project.pmDir, "loop", "events")), false);
  assert.equal(fs.existsSync(path.join(project.pmDir, "loop", "leases")), false);
});

test("loop runner non-dry-run blocks before dispatch unless claim-only is explicit", (t) => {
  const project = createProject();
  t.after(project.cleanup);

  project.write(
    "pm/backlog/approved-task.md",
    fm({
      type: "backlog",
      id: "PM-004",
      title: "Approved task",
      kind: "task",
      status: "planned",
      implementation_approved: "true",
      approved_by: "soelinmyat",
      approved_at: "2026-06-23",
      updated: "2026-06-22",
    }) + "body"
  );

  const result = runLoop(project.root, {
    now: FIXED_NOW,
    mode: "dev",
    dryRun: false,
    claimOnly: false,
    config: config({ autonomy: { start_dev: true } }),
  });

  assert.equal(result.status, "blocked");
  assert.match(result.reason, /loop-runner selects and claims only/);
});

test("loop runner claim-only commits a lease without leaving uncommitted event files", (t) => {
  const project = createProject();
  t.after(project.cleanup);

  project.write(
    "pm/backlog/approved-task.md",
    fm({
      type: "backlog",
      id: "PM-005",
      title: "Approved task",
      kind: "task",
      status: "planned",
      implementation_approved: "true",
      approved_by: "soelinmyat",
      approved_at: "2026-06-23",
      updated: "2026-06-22",
    }) + "body"
  );
  initGit(project);
  attachRemote(project, t);

  const result = runLoop(project.root, {
    now: FIXED_NOW,
    mode: "dev",
    dryRun: false,
    claimOnly: true,
    config: config({ autonomy: { start_dev: true } }),
  });

  assert.equal(result.status, "claimed");
  assert.equal(result.mutation, true);
  assert.equal(fs.existsSync(path.join(project.pmDir, "loop", "events")), false);
  assert.equal(git(project.root, ["status", "--porcelain"]), "");
});

test("loop runner skip-push blocks and cleans the local lease commit", (t) => {
  const project = createProject();
  t.after(project.cleanup);

  project.write(
    "pm/backlog/approved-task.md",
    fm({
      type: "backlog",
      id: "PM-006",
      title: "Approved task",
      kind: "task",
      status: "planned",
      implementation_approved: "true",
      approved_by: "soelinmyat",
      approved_at: "2026-06-23",
      updated: "2026-06-22",
    }) + "body"
  );
  initGit(project);

  const before = git(project.root, ["rev-parse", "HEAD"]);
  const result = runLoop(project.root, {
    now: FIXED_NOW,
    mode: "dev",
    dryRun: false,
    claimOnly: true,
    skipPull: true,
    skipPush: true,
    allowUnsynced: true,
    config: config({ autonomy: { start_dev: true } }),
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "push-skipped");
  assert.equal(git(project.root, ["rev-parse", "HEAD"]), before);
  assert.equal(git(project.root, ["status", "--porcelain"]), "");
});

test("loop runner pulls before mutating selection", (t) => {
  const project = createProject();
  t.after(project.cleanup);

  project.write(
    "pm/backlog/approved-task.md",
    fm({
      type: "backlog",
      id: "PM-007",
      title: "Approved task",
      kind: "task",
      status: "planned",
      implementation_approved: "true",
      approved_by: "soelinmyat",
      approved_at: "2026-06-23",
      updated: "2026-06-22",
    }) + "body"
  );
  initGit(project);
  const remote = attachRemote(project, t);
  updateRemote(remote, (clone) => {
    fs.writeFileSync(
      path.join(clone, "pm", "backlog", "approved-task.md"),
      fm({
        type: "backlog",
        id: "PM-007",
        title: "Approved task",
        kind: "task",
        status: "shipped",
        implementation_approved: "true",
        approved_by: "soelinmyat",
        approved_at: "2026-06-23",
        updated: "2026-06-23",
      }) + "body"
    );
  });

  const result = runLoop(project.root, {
    now: FIXED_NOW,
    mode: "dev",
    dryRun: false,
    claimOnly: true,
    config: config({ autonomy: { start_dev: true } }),
  });

  assert.equal(result.status, "idle");
  assert.equal(result.selected, null);
  assert.equal(git(project.root, ["status", "--porcelain"]), "");
});

test("loop runner cleans local lease commit when push is rejected", (t) => {
  const project = createProject();
  t.after(project.cleanup);

  project.write(
    "pm/backlog/approved-task.md",
    fm({
      type: "backlog",
      id: "PM-010",
      title: "Approved task",
      kind: "task",
      status: "planned",
      implementation_approved: "true",
      approved_by: "soelinmyat",
      approved_at: "2026-06-23",
      updated: "2026-06-22",
    }) + "body"
  );
  initGit(project);
  const remote = attachRemote(project, t);
  updateRemote(remote, (clone) => {
    fs.appendFileSync(path.join(clone, "pm", "backlog", "approved-task.md"), "\nremote note\n");
  });

  const before = git(project.root, ["rev-parse", "HEAD"]);
  const result = runLoop(project.root, {
    now: FIXED_NOW,
    mode: "dev",
    dryRun: false,
    claimOnly: true,
    skipPull: true,
    allowUnsynced: true,
    config: config({ autonomy: { start_dev: true } }),
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "push-failed");
  assert.equal(git(project.root, ["rev-parse", "HEAD"]), before);
  assert.equal(git(project.root, ["status", "--porcelain"]), "");
});

test("loop runner enforces implementing WIP limit before selecting new dev", () => {
  const board = {
    columns: {
      implementing: [
        {
          id: "PM-008",
          implementationApproved: true,
          lease: { stage: "dev" },
        },
      ],
      ready_for_dev: [
        {
          id: "PM-009",
          title: "Next task",
          kind: "task",
          implementationApproved: true,
          command: "/pm:dev PM-009",
        },
      ],
    },
  };

  const selected = selectNextCard(board, config({ autonomy: { start_dev: true } }), {
    mode: "dev",
  });

  assert.equal(selected.card, null);
  assert.equal(selected.skipped[1].reason, "wip limit implementing reached");
});
