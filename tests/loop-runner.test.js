"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { buildLoopBoard } = require("../scripts/loop-board.js");
const { DEFAULT_LOOP_CONFIG } = require("../scripts/loop-config.js");
const { runLoop, selectNextCard } = require("../scripts/loop-runner.js");

const FIXED_NOW = new Date("2026-06-23T00:00:00Z");

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

function config(overrides = {}) {
  return {
    ...DEFAULT_LOOP_CONFIG,
    autonomy: {
      ...DEFAULT_LOOP_CONFIG.autonomy,
      ...(overrides.autonomy || {}),
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
  assert.match(result.reason, /worker dispatch is not enabled/);
});
