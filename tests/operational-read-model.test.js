"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { buildOperationalSnapshot } = require("../scripts/lib/operational-read-model.js");
const { emitListRows } = require("../scripts/lib/list-rows.js");
const { buildStatus } = require("../scripts/start-status.js");
const { buildBoardPayload } = require("../scripts/board-server.js");
const { assessSituation } = require("../scripts/loop-situation.js");

const NOW = new Date("2026-06-23T12:00:00.000Z");

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-operational-read-model-"));
  const write = (relativePath, contents) => {
    const filePath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents);
    return filePath;
  };
  fs.mkdirSync(path.join(root, "pm", "backlog"), { recursive: true });
  write(".pm/config.json", JSON.stringify({ sync: { backend: "git" } }));
  return { root, pmDir: path.join(root, "pm"), write };
}

function card(fields) {
  const lines = ["---", "type: backlog"];
  for (const [name, value] of Object.entries(fields)) lines.push(`${name}: ${value}`);
  return `${lines.join("\n")}\n---\n`;
}

function seedMixedState(project) {
  project.write(
    "pm/backlog/idea.md",
    card({ id: "PM-001", title: "Idea", kind: "proposal", status: "idea" })
  );
  project.write(
    "pm/backlog/proposal.md",
    card({ id: "PM-002", title: "Proposal", kind: "proposal", status: "planned" })
  );
  project.write(
    "pm/backlog/ready.md",
    card({
      id: "PM-003",
      title: "Ready",
      kind: "task",
      status: "planned",
      implementation_approved: true,
      approved_by: "operator",
      approved_at: "2026-06-23",
    })
  );
  project.write(
    "pm/backlog/active.md",
    card({ id: "PM-004", title: "Active", kind: "task", status: "in-progress" })
  );
  project.write(
    "pm/backlog/done.md",
    card({ id: "PM-005", title: "Done", kind: "task", status: "done" })
  );
  project.write(
    "pm/loop/leases/dev-pm-004.json",
    JSON.stringify({
      version: 1,
      card_id: "PM-004",
      stage: "dev",
      holder: "machine-a",
      runtime: "codex",
      claimed_at: "2026-06-23T11:30:00.000Z",
      expires_at: "2026-06-23T12:30:00.000Z",
    })
  );
  project.write(
    "pm/loop/leases/dev-expired.json",
    JSON.stringify({
      version: 1,
      card_id: "PM-999",
      stage: "dev",
      holder: "machine-b",
      claimed_at: "2026-06-22T10:00:00.000Z",
      expires_at: "2026-06-22T11:00:00.000Z",
    })
  );
  project.write("pm/loop/leases/invalid.json", "not json");
  project.write(
    ".pm/loop-runs/run-1.json",
    JSON.stringify({
      version: 1,
      run_id: "run-1",
      status: "completed",
      stage: "dev",
      card: { id: "PM-005", title: "Done" },
      started_at: "2026-06-23T10:00:00.000Z",
      ended_at: "2026-06-23T10:05:00.000Z",
    })
  );
}

test("one snapshot owns lifecycle, leases, budgets, delivery, and recovery", (t) => {
  const project = makeProject();
  t.after(() => fs.rmSync(project.root, { recursive: true, force: true }));
  seedMixedState(project);

  const snapshot = buildOperationalSnapshot(project.root, { now: NOW });
  const lifecycle = Object.fromEntries(
    snapshot.work_items.map((item) => [item.id, item.lifecycle])
  );

  assert.equal(snapshot.schema_version, 1);
  assert.deepEqual(lifecycle, {
    "PM-001": "inbox",
    "PM-002": "needs_rfc",
    "PM-003": "ready_for_dev",
    "PM-004": "implementing",
    "PM-005": "done",
  });
  assert.deepEqual(snapshot.counts.lifecycle, {
    inbox: 1,
    needs_research: 0,
    needs_rfc: 1,
    ready_for_dev: 1,
    implementing: 1,
    reviewing: 0,
    shipping: 0,
    needs_human: 0,
    blocked: 0,
    done: 1,
  });
  assert.equal(snapshot.leases.active.length, 1);
  assert.equal(snapshot.leases.expired.length, 1);
  assert.equal(snapshot.leases.invalid.length, 1);
  assert.equal(snapshot.loop.budgets.runs_today, 1);
  assert.equal(snapshot.recent_delivery.runs[0].run_id, "run-1");
  assert.deepEqual(snapshot.recovery_actions.map((action) => action.code).sort(), [
    "inspect-expired-lease",
    "repair-invalid-lease",
  ]);
  assert.match(snapshot.meta.observation_id, /^op_[a-f0-9]{64}$/);
});

test("observation identity is independent of generated time and absolute project path", (t) => {
  const left = makeProject();
  const right = makeProject();
  t.after(() => fs.rmSync(left.root, { recursive: true, force: true }));
  t.after(() => fs.rmSync(right.root, { recursive: true, force: true }));
  seedMixedState(left);
  seedMixedState(right);

  const first = buildOperationalSnapshot(left.root, { now: NOW });
  const second = buildOperationalSnapshot(right.root, {
    now: new Date("2026-06-23T12:00:30.000Z"),
  });
  assert.equal(first.meta.observation_id, second.meta.observation_id);
});

test("Start, List, and Board project the supplied snapshot without rescanning", (t) => {
  const project = makeProject();
  t.after(() => fs.rmSync(project.root, { recursive: true, force: true }));
  seedMixedState(project);
  const snapshot = buildOperationalSnapshot(project.root, { now: NOW });

  fs.rmSync(path.join(project.root, "pm", "backlog"), { recursive: true, force: true });
  fs.rmSync(path.join(project.root, "pm", "loop"), { recursive: true, force: true });
  fs.rmSync(path.join(project.root, ".pm", "loop-runs"), { recursive: true, force: true });

  const list = emitListRows(project.root, { now: NOW, snapshot });
  const start = buildStatus(project.root, { now: NOW, snapshot });
  const board = buildBoardPayload({ pmDir: project.pmDir, now: NOW, snapshot });
  const situation = assessSituation(project.root, {
    now: NOW,
    snapshot,
    installedProbe: () => false,
  });

  const listLifecycle = Object.fromEntries(
    [...list.proposals, ...list.rfcs, ...list.shipped].map((row) => [row.id, row.lifecycle])
  );
  const boardLifecycle = Object.fromEntries(board.cards.map((row) => [row.id, row.column]));
  assert.deepEqual(listLifecycle, boardLifecycle);
  assert.deepEqual(start.operational.counts.lifecycle, snapshot.counts.lifecycle);
  assert.equal(start.operational.observation_id, snapshot.meta.observation_id);
  assert.equal(board.observation_id, snapshot.meta.observation_id);
  assert.equal(situation.observationId, snapshot.meta.observation_id);
  assert.deepEqual(situation.board.counts, snapshot.counts.lifecycle);
  assert.deepEqual(
    situation.board.ready.map((item) => item.id),
    snapshot.columns.ready_for_dev
  );
});
