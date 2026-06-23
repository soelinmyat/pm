"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { buildLoopBoard } = require("../scripts/loop-board.js");
const { writeJsonAtomic } = require("../scripts/loop-git.js");

const FIXED_NOW = new Date("2026-06-23T00:00:00Z");

function createProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-loop-board-"));
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

function ids(rows) {
  return rows.map((row) => row.id);
}

test("loop board classifies backlog cards by durable git-backed fields", (t) => {
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
      priority: "high",
      updated: "2026-06-22",
    }) + "body"
  );
  project.write(
    "pm/backlog/unapproved-bug.md",
    fm({
      type: "backlog",
      id: "PM-002",
      title: "Unapproved bug",
      kind: "bug",
      status: "planned",
      updated: "2026-06-21",
    }) + "body"
  );
  project.write(
    "pm/backlog/proposal-without-rfc.md",
    fm({
      type: "backlog",
      id: "PM-003",
      title: "Proposal without RFC",
      status: "proposed",
      updated: "2026-06-20",
    }) + "body"
  );
  project.write(
    "pm/backlog/shipped.md",
    fm({
      type: "backlog",
      id: "PM-004",
      title: "Shipped",
      kind: "task",
      status: "shipped",
      updated: "2026-06-19",
    }) + "body"
  );

  const board = buildLoopBoard(project.root, { now: FIXED_NOW });

  assert.deepEqual(ids(board.columns.ready_for_dev), ["PM-001"]);
  assert.deepEqual(ids(board.columns.needs_human), ["PM-002"]);
  assert.deepEqual(ids(board.columns.needs_rfc), ["PM-003"]);
  assert.deepEqual(ids(board.columns.done), ["PM-004"]);
  assert.match(board.columns.needs_human[0].blocker, /implementation_approved/);
  assert.equal(board.columns.ready_for_dev[0].command, "/pm:dev PM-001");
});

test("loop board treats pm/loop leases as durable state and .pm sessions as local-only", (t) => {
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
      updated: "2026-06-22",
    }) + "body"
  );
  project.write(
    ".pm/dev-sessions/epic-local.md",
    "| Ticket | PM-LOCAL |\n| Stage | implement |\n- Next action: local only\n"
  );
  writeJsonAtomic(path.join(project.pmDir, "loop", "leases", "dev-pm-010.json"), {
    version: 1,
    card_id: "PM-010",
    stage: "dev",
    holder: "machine-a",
    runtime: "codex",
    claimed_at: "2026-06-22T23:30:00Z",
    expires_at: "2026-06-23T00:30:00Z",
  });

  const board = buildLoopBoard(project.root, { now: FIXED_NOW, includeLocal: true });

  assert.deepEqual(ids(board.columns.ready_for_dev), []);
  assert.deepEqual(ids(board.columns.implementing), ["PM-010"]);
  assert.equal(board.columns.implementing[0].lease.holder, "machine-a");
  assert.equal(board.leases.active.length, 1);
  assert.equal(board.localOnly.length, 1);
  assert.equal(board.localOnly[0].topic, "local");
});

test("loop board overlays git-synced session snapshots without reading .pm for eligibility", (t) => {
  const project = createProject();
  t.after(project.cleanup);

  project.write(
    "pm/backlog/approved-task.md",
    fm({
      type: "backlog",
      id: "PM-020",
      title: "Approved task",
      kind: "task",
      status: "planned",
      implementation_approved: "true",
      updated: "2026-06-22",
    }) + "body"
  );
  writeJsonAtomic(path.join(project.pmDir, "loop", "session-snapshots", "pm-020.json"), {
    card_id: "PM-020",
    title: "Approved task",
    stage: "review",
    updated_at: "2026-06-22T23:00:00Z",
  });

  const board = buildLoopBoard(project.root, { now: FIXED_NOW });

  assert.deepEqual(ids(board.columns.reviewing), ["PM-020"]);
  assert.equal(board.columns.reviewing[0].snapshot.stage, "review");
  assert.deepEqual(board.localOnly, []);
});
