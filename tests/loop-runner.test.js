"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { buildLoopBoard } = require("../scripts/loop-board.js");
const { DEFAULT_LOOP_CONFIG, loadLoopConfig } = require("../scripts/loop-config.js");
const { runLoop, selectNextCard } = require("../scripts/loop-runner.js");
const { markRunDispatched } = require("../scripts/loop-pm-transaction.js");

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
  git(project.root, ["add", "pm"]);
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
    git(clone, ["add", "-A"]);
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

test("loop runner claim-only commits lease and attempt event without moving the shared checkout", (t) => {
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
  const remote = attachRemote(project, t);
  const sharedHead = git(project.root, ["rev-parse", "HEAD"]);

  const resolved = config({ autonomy: { start_dev: true } });
  const exactPlan = runLoop(project.root, {
    now: FIXED_NOW,
    mode: "dev",
    dryRun: true,
    config: resolved,
  });

  const result = runLoop(project.root, {
    now: FIXED_NOW,
    mode: "dev",
    dryRun: false,
    claimOnly: true,
    config: resolved,
    expectedPlan: exactPlan,
  });

  assert.equal(result.status, "claimed");
  assert.equal(result.mutation, true);
  assert.equal(fs.existsSync(path.join(project.pmDir, "loop", "events")), false);
  assert.equal(git(project.root, ["rev-parse", "HEAD"]), sharedHead);
  assert.equal(git(project.root, ["status", "--porcelain"]), "");
  assert.equal(
    runGit(
      ["--git-dir", remote, "cat-file", "-e", `main:pm/loop/events/${result.run_id}.json`],
      project.root
    ),
    ""
  );
});

test("next wake stops for durable never-dispatched and dispatched run state", (t) => {
  const project = createProject();
  t.after(project.cleanup);
  project.write(
    "pm/backlog/recovery-task.md",
    fm({
      type: "backlog",
      id: "PM-REC1",
      title: "Recovery task",
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
  const resolved = config({ autonomy: { start_dev: true } });
  const exactPlan = runLoop(project.root, {
    now: FIXED_NOW,
    mode: "dev",
    dryRun: true,
    config: resolved,
  });
  const claimed = runLoop(project.root, {
    now: FIXED_NOW,
    mode: "dev",
    dryRun: false,
    claimOnly: true,
    config: resolved,
    expectedPlan: exactPlan,
  });
  assert.equal(claimed.status, "claimed");

  let nextWake = runLoop(project.root, {
    now: FIXED_NOW,
    mode: "dev",
    dryRun: true,
    config: resolved,
  });
  assert.equal(nextWake.status, "recovery-required");
  assert.equal(nextWake.recovery.state, "never-dispatched");
  assert.equal(nextWake.selected, null);

  const dispatched = markRunDispatched(project.pmDir, {
    runId: claimed.run_id,
    cardId: "PM-REC1",
    stage: "dev",
  });
  assert.equal(dispatched.ok, true, JSON.stringify(dispatched));
  nextWake = runLoop(project.root, {
    now: FIXED_NOW,
    mode: "dev",
    dryRun: true,
    config: resolved,
  });
  assert.equal(nextWake.status, "recovery-required");
  assert.equal(nextWake.recovery.state, "dispatched-without-terminal-result");
  assert.equal(nextWake.selected, null);
});

test("loop runner refuses a claim that does not present a preflighted exact plan", (t) => {
  const project = createProject();
  t.after(project.cleanup);
  project.write(
    "pm/backlog/approved-task.md",
    fm({
      type: "backlog",
      id: "PM-016",
      title: "Needs exact plan",
      kind: "task",
      status: "planned",
      implementation_approved: "true",
      approved_by: "soelinmyat",
      approved_at: "2026-06-23",
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
  assert.equal(result.status, "blocked");
  assert.match(result.reason, /exact read-only plan/);
  assert.equal(fs.existsSync(path.join(project.pmDir, "loop", "leases")), false);
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
  attachRemote(project, t);

  const before = git(project.root, ["rev-parse", "HEAD"]);
  const resolved = config({ autonomy: { start_dev: true } });
  const exactPlan = runLoop(project.root, {
    now: FIXED_NOW,
    mode: "dev",
    dryRun: true,
    config: resolved,
  });
  const result = runLoop(project.root, {
    now: FIXED_NOW,
    mode: "dev",
    dryRun: false,
    claimOnly: true,
    skipPull: true,
    skipPush: true,
    allowUnsynced: true,
    config: resolved,
    expectedPlan: exactPlan,
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "push-skipped");
  assert.equal(git(project.root, ["rev-parse", "HEAD"]), before);
  assert.equal(git(project.root, ["status", "--porcelain"]), "");
});

test("loop runner fetches authoritative PM state without moving the shared checkout", (t) => {
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
  const resolved = config({ autonomy: { start_dev: true } });
  const exactPlan = runLoop(project.root, {
    now: FIXED_NOW,
    mode: "dev",
    dryRun: true,
    config: resolved,
  });
  const sharedHead = git(project.root, ["rev-parse", "HEAD"]);
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
    config: resolved,
    expectedPlan: exactPlan,
  });

  assert.equal(result.status, "plan-stale");
  assert.equal(result.expected_selected_id, "PM-007");
  assert.equal(result.selected, null);
  assert.equal(git(project.root, ["rev-parse", "HEAD"]), sharedHead);
  assert.equal(git(project.root, ["status", "--porcelain"]), "");
});

test("loop runner rejects an upstream advance before claim without moving shared HEAD", (t) => {
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
  const before = git(project.root, ["rev-parse", "HEAD"]);
  const resolved = config({ autonomy: { start_dev: true } });
  const exactPlan = runLoop(project.root, {
    now: FIXED_NOW,
    mode: "dev",
    dryRun: true,
    config: resolved,
  });
  updateRemote(remote, (clone) => {
    fs.appendFileSync(path.join(clone, "pm", "backlog", "approved-task.md"), "\nremote note\n");
  });
  const result = runLoop(project.root, {
    now: FIXED_NOW,
    mode: "dev",
    dryRun: false,
    claimOnly: true,
    skipPull: true,
    allowUnsynced: true,
    config: resolved,
    expectedPlan: exactPlan,
  });

  assert.equal(result.status, "plan-stale");
  assert.match(result.reason, /exact plan changed/);
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

test("read-only plans fingerprint the exact card, eligibility, config, source base, stage, and id", (t) => {
  const project = createProject();
  t.after(project.cleanup);
  project.write(
    "pm/backlog/fingerprinted.md",
    fm({
      type: "backlog",
      id: "PM-011",
      title: "Fingerprint me",
      kind: "task",
      status: "planned",
      implementation_approved: "true",
      approved_by: "soelinmyat",
      approved_at: "2026-06-23",
      updated: "2026-06-23",
    }) + "original body"
  );
  initGit(project);
  attachRemote(project, t);

  const resolved = config({ autonomy: { start_dev: true } });
  const plan = runLoop(project.root, {
    now: FIXED_NOW,
    mode: "dev",
    dryRun: true,
    config: resolved,
  });

  assert.match(plan.fingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.equal(plan.source_base_oid, git(project.root, ["rev-parse", "HEAD"]));
  assert.equal(plan.fingerprint_input.selected_id, "PM-011");
  assert.equal(plan.fingerprint_input.stage, "dev");
  assert.equal(plan.fingerprint_input.source_base_oid, plan.source_base_oid);
  assert.equal(plan.fingerprint_input.pm_head_oid, git(project.root, ["rev-parse", "HEAD"]));
  assert.match(plan.fingerprint_input.card_revision, /^sha256:[a-f0-9]{64}$/);
  assert.match(plan.fingerprint_input.execution_config_hash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(plan.fingerprint_input.eligibility.implementation_approved, true);
});

test("claim reloads Git-synced config after pull and rejects exact-plan config drift", (t) => {
  const project = createProject();
  t.after(project.cleanup);
  project.write(
    "pm/backlog/config-drift.md",
    fm({
      type: "backlog",
      id: "PM-016",
      title: "Config drift",
      kind: "task",
      status: "planned",
      implementation_approved: "true",
      approved_by: "soelinmyat",
      approved_at: "2026-06-23",
    }) + "body"
  );
  project.write(
    "pm/loop/config.json",
    `${JSON.stringify({ version: 2, autonomy: { start_dev: true, merge_pr: false } }, null, 2)}\n`
  );
  initGit(project);
  const remote = attachRemote(project, t);
  const initialConfig = loadLoopConfig(project.pmDir);
  const exactPlan = runLoop(project.root, {
    now: FIXED_NOW,
    mode: "dev",
    dryRun: true,
    config: initialConfig,
  });

  updateRemote(remote, (clone) => {
    fs.writeFileSync(
      path.join(clone, "pm", "loop", "config.json"),
      `${JSON.stringify({ version: 2, autonomy: { start_dev: true, merge_pr: true } }, null, 2)}\n`
    );
  });

  const result = runLoop(project.root, {
    now: FIXED_NOW,
    mode: "dev",
    dryRun: false,
    claimOnly: true,
    config: initialConfig,
    expectedPlan: exactPlan,
    reloadConfigAfterPull: true,
  });

  assert.equal(result.status, "plan-stale");
  assert.equal(result.mutation, false);
  assert.notEqual(result.current_fingerprint, exactPlan.fingerprint);
  assert.equal(fs.existsSync(path.join(project.pmDir, "loop", "leases")), false);
});

test("claim never resets an operator's unpushed shared-checkout commit", (t) => {
  const project = createProject();
  t.after(project.cleanup);
  const cardPath = project.write(
    "pm/backlog/claim-race.md",
    fm({
      type: "backlog",
      id: "PM-017",
      title: "Claim race",
      kind: "task",
      status: "planned",
      implementation_approved: "true",
      approved_by: "soelinmyat",
      approved_at: "2026-06-23",
    }) + "original"
  );
  initGit(project);
  attachRemote(project, t);
  const resolved = config({ autonomy: { start_dev: true } });
  const exactPlan = runLoop(project.root, {
    now: FIXED_NOW,
    mode: "dev",
    dryRun: true,
    config: resolved,
  });

  let operatorHead = "";
  const result = runLoop(project.root, {
    now: FIXED_NOW,
    mode: "dev",
    dryRun: false,
    claimOnly: true,
    config: resolved,
    expectedPlan: exactPlan,
    beforeClaim() {
      fs.appendFileSync(cardPath, "raced\n");
      git(project.root, ["add", "pm/backlog/claim-race.md"]);
      git(project.root, ["commit", "-m", "race card before claim"]);
      operatorHead = git(project.root, ["rev-parse", "HEAD"]);
    },
  });

  assert.equal(result.status, "claimed");
  assert.equal(result.mutation, true);
  assert.equal(git(project.root, ["rev-parse", "HEAD"]), operatorHead);
  assert.equal(fs.existsSync(path.join(project.pmDir, "loop", "leases")), false);
  assert.equal(git(project.root, ["status", "--porcelain"]), "");
});

test("source base resolves the remote default branch and never falls back to feature HEAD", (t) => {
  const project = createProject();
  t.after(project.cleanup);
  project.write(
    "pm/backlog/default-branch.md",
    fm({
      type: "backlog",
      id: "PM-018",
      title: "Default branch",
      kind: "task",
      status: "planned",
      implementation_approved: "true",
      approved_by: "soelinmyat",
      approved_at: "2026-06-23",
    }) + "body"
  );
  initGit(project);
  const remote = attachRemote(project, t);
  git(project.root, ["branch", "-M", "trunk"]);
  git(project.root, ["push", "-u", "origin", "trunk"]);
  runGit(["--git-dir", remote, "symbolic-ref", "HEAD", "refs/heads/trunk"], project.root);
  git(project.root, ["push", "origin", "--delete", "main"]);
  git(project.root, ["update-ref", "-d", "refs/remotes/origin/HEAD"]);
  git(project.root, ["update-ref", "-d", "refs/remotes/origin/main"]);
  const trunkOid = git(project.root, ["rev-parse", "HEAD"]);
  git(project.root, ["switch", "-c", "feature"]);
  project.write("feature-only.txt", "feature\n");
  git(project.root, ["add", "feature-only.txt"]);
  git(project.root, ["commit", "-m", "feature tip"]);

  const plan = runLoop(project.root, {
    now: FIXED_NOW,
    mode: "dev",
    dryRun: true,
    config: config({ autonomy: { start_dev: true } }),
  });

  assert.equal(plan.source_base_oid, trunkOid);
  assert.notEqual(plan.source_base_oid, git(project.root, ["rev-parse", "HEAD"]));
});

test("claim reselects the exact plan after pull and aborts drift without substituting a lower card", (t) => {
  const project = createProject();
  t.after(project.cleanup);
  project.write(
    "pm/backlog/first.md",
    fm({
      type: "backlog",
      id: "PM-012",
      title: "First",
      kind: "task",
      priority: "critical",
      status: "planned",
      implementation_approved: "true",
      approved_by: "soelinmyat",
      approved_at: "2026-06-23",
      updated: "2026-06-23",
    }) + "first"
  );
  project.write(
    "pm/backlog/second.md",
    fm({
      type: "backlog",
      id: "PM-013",
      title: "Second",
      kind: "task",
      priority: "low",
      status: "planned",
      implementation_approved: "true",
      approved_by: "soelinmyat",
      approved_at: "2026-06-23",
      updated: "2026-06-22",
    }) + "second"
  );
  initGit(project);
  const remote = attachRemote(project, t);
  const resolved = config({ autonomy: { start_dev: true } });
  const exactPlan = runLoop(project.root, {
    now: FIXED_NOW,
    mode: "dev",
    dryRun: true,
    config: resolved,
  });
  assert.equal(exactPlan.selected.id, "PM-012");

  updateRemote(remote, (clone) => {
    fs.writeFileSync(
      path.join(clone, "pm", "backlog", "first.md"),
      fm({
        type: "backlog",
        id: "PM-012",
        title: "First",
        kind: "task",
        priority: "critical",
        status: "done",
        implementation_approved: "true",
        approved_by: "soelinmyat",
        approved_at: "2026-06-23",
        updated: "2026-06-24",
      }) + "changed"
    );
  });
  const remoteBeforeClaim = runGit(["--git-dir", remote, "rev-parse", "main"], project.root);

  const result = runLoop(project.root, {
    now: FIXED_NOW,
    mode: "dev",
    dryRun: false,
    claimOnly: true,
    config: resolved,
    expectedPlan: exactPlan,
  });

  assert.equal(result.status, "plan-stale");
  assert.equal(result.mutation, false);
  assert.equal(result.expected_selected_id, "PM-012");
  assert.equal(result.selected.id, "PM-013", "reports drift but never substitutes it for claim");
  assert.equal(fs.existsSync(path.join(project.pmDir, "loop", "leases")), false);
  assert.equal(runGit(["--git-dir", remote, "rev-parse", "main"], project.root), remoteBeforeClaim);
});

test("quarantine-aware selection skips the matching candidate and keeps lower priority work eligible", () => {
  const board = {
    columns: {
      ready_for_dev: [
        { id: "PM-014", title: "First", implementationApproved: true },
        { id: "PM-015", title: "Second", implementationApproved: true },
      ],
      implementing: [],
    },
  };
  const selected = selectNextCard(board, config({ autonomy: { start_dev: true } }), {
    mode: "dev",
    quarantineCheck: (card) =>
      card.id === "PM-014"
        ? { quarantined: true, blocker_code: "engine-auth-failed", expires_at: "later" }
        : null,
  });
  assert.equal(selected.card.id, "PM-015");
  assert.deepEqual(selected.skipped[0], {
    id: "PM-014",
    column: "ready_for_dev",
    reason: "preflight quarantine: engine-auth-failed",
    quarantine_expires_at: "later",
  });
});
