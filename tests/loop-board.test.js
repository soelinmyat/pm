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

function approvedCard(id, title, extra = "") {
  return [
    "---",
    "type: backlog",
    `id: "${id}"`,
    `title: "${title}"`,
    "kind: task",
    "status: planned",
    "implementation_approved: true",
    "approved_by: soelinmyat",
    "approved_at: 2026-06-23",
    extra,
    "---",
    "",
  ]
    .filter(Boolean)
    .join("\n");
}

test("epic parent with open children is never dispatchable; children run in order", (t) => {
  const project = createProject();
  t.after(project.cleanup);

  project.write(
    "pm/backlog/currency.md",
    approvedCard(
      "PM-100",
      "Epic: currency",
      ["children:", '  - "currency-api"', '  - "currency-ui"'].join("\n")
    )
  );
  project.write(
    "pm/backlog/currency-api.md",
    approvedCard("PM-101", "API slice", 'parent: "currency"')
  );
  project.write(
    "pm/backlog/currency-ui.md",
    approvedCard("PM-102", "UI slice", 'parent: "currency"')
  );

  const board = buildLoopBoard(project.root, { now: FIXED_NOW });

  // Parent is an umbrella — blocked, not ready, despite full approval.
  const blocked = board.columns.blocked;
  assert.ok(ids(blocked).includes("PM-100"), JSON.stringify(board.columns));
  assert.match(blocked.find((c) => c.id === "PM-100").blocker, /epic umbrella/);

  // First child is dispatchable; second waits on its earlier sibling.
  assert.ok(ids(board.columns.ready_for_dev).includes("PM-101"));
  assert.ok(ids(blocked).includes("PM-102"));
  assert.match(blocked.find((c) => c.id === "PM-102").blocker, /earlier sibling.*currency-api/);
});

test("child becomes dispatchable when earlier sibling is done or its card is deleted", (t) => {
  const project = createProject();
  t.after(project.cleanup);

  project.write(
    "pm/backlog/epic.md",
    approvedCard(
      "PM-200",
      "Epic",
      ["children:", '  - "epic-a"', '  - "epic-b"', '  - "epic-c"'].join("\n")
    )
  );
  // epic-a: done via status; epic-b: card deleted at retro close-out (absent);
  // epic-c should therefore be dispatchable.
  project.write(
    "pm/backlog/epic-a.md",
    [
      "---",
      "type: backlog",
      'id: "PM-201"',
      'title: "A"',
      "kind: task",
      "status: done",
      'parent: "epic"',
      "---",
      "",
    ].join("\n")
  );
  project.write("pm/backlog/epic-c.md", approvedCard("PM-203", "C", 'parent: "epic"'));

  const board = buildLoopBoard(project.root, { now: FIXED_NOW });
  assert.ok(ids(board.columns.ready_for_dev).includes("PM-203"), JSON.stringify(board.columns));
});

test("parent with all children done lands in needs_human for close-out", (t) => {
  const project = createProject();
  t.after(project.cleanup);

  project.write(
    "pm/backlog/epic.md",
    approvedCard("PM-300", "Epic", ["children:", '  - "epic-gone"'].join("\n"))
  );

  const board = buildLoopBoard(project.root, { now: FIXED_NOW });
  const row = board.columns.needs_human.find((c) => c.id === "PM-300");
  assert.ok(row, JSON.stringify(board.columns));
  assert.match(row.blocker, /close out the epic parent/);
});

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
      approved_by: "soelinmyat",
      approved_at: "2026-06-23",
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
      approved_by: "soelinmyat",
      approved_at: "2026-06-23",
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
      approved_by: "soelinmyat",
      approved_at: "2026-06-23",
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

test("loop board maps rfc snapshots to needs_rfc and sorts critical priority first", (t) => {
  const project = createProject();
  t.after(project.cleanup);

  project.write(
    "pm/backlog/high-task.md",
    fm({
      type: "backlog",
      id: "PM-030",
      title: "High task",
      kind: "task",
      status: "planned",
      implementation_approved: "true",
      approved_by: "soelinmyat",
      approved_at: "2026-06-23",
      priority: "high",
      updated: "2026-06-22",
    }) + "body"
  );
  project.write(
    "pm/backlog/critical-task.md",
    fm({
      type: "backlog",
      id: "PM-031",
      title: "Critical task",
      kind: "task",
      status: "planned",
      implementation_approved: "true",
      approved_by: "soelinmyat",
      approved_at: "2026-06-23",
      priority: "critical",
      updated: "2026-06-21",
    }) + "body"
  );
  writeJsonAtomic(path.join(project.pmDir, "loop", "session-snapshots", "pm-032.json"), {
    card_id: "PM-032",
    title: "RFC in progress",
    kind: "proposal",
    stage: "rfc",
    updated_at: "2026-06-22T23:00:00Z",
  });

  const board = buildLoopBoard(project.root, { now: FIXED_NOW });

  assert.deepEqual(ids(board.columns.ready_for_dev), ["PM-031", "PM-030"]);
  assert.deepEqual(ids(board.columns.needs_rfc), ["PM-032"]);
});

test("loop board requires approval audit fields before ready_for_dev", (t) => {
  const project = createProject();
  t.after(project.cleanup);

  project.write(
    "pm/backlog/approved-without-audit.md",
    fm({
      type: "backlog",
      id: "PM-040",
      title: "Approved without audit",
      kind: "task",
      status: "planned",
      implementation_approved: "true",
      updated: "2026-06-22",
    }) + "body"
  );

  const board = buildLoopBoard(project.root, { now: FIXED_NOW });

  assert.deepEqual(ids(board.columns.ready_for_dev), []);
  assert.deepEqual(ids(board.columns.needs_human), ["PM-040"]);
});

test("loop board skips backlog index and blocks invalid card files", (t) => {
  const project = createProject();
  t.after(project.cleanup);

  project.write("pm/backlog/index.md", "# Backlog index\n");
  project.write("pm/backlog/no-frontmatter.md", "# Missing frontmatter\n");

  const board = buildLoopBoard(project.root, { now: FIXED_NOW });

  assert.equal(
    board.cards.some((card) => card.slug === "index"),
    false
  );
  assert.deepEqual(ids(board.columns.needs_human), ["no-frontmatter"]);
  assert.match(board.columns.needs_human[0].blocker, /missing backlog frontmatter/);
});

test("loop board carries display-only size and prs on the card model", (t) => {
  const project = createProject();
  t.after(project.cleanup);

  project.write(
    "pm/backlog/sized.md",
    approvedCard("PM-060", "Sized", ['size: "M"', 'prs: ["#42", "#43"]'].join("\n"))
  );
  project.write("pm/backlog/plain.md", approvedCard("PM-061", "Plain"));

  const board = buildLoopBoard(project.root, { now: FIXED_NOW });
  const byId = new Map(board.cards.map((card) => [card.id, card]));

  assert.equal(byId.get("PM-060").size, "M");
  assert.deepEqual(byId.get("PM-060").prs, ["#42", "#43"]);
  // Parity: unspecified fields default, never undefined.
  assert.equal(byId.get("PM-061").size, "");
  assert.deepEqual(byId.get("PM-061").prs, []);
});

test("loop board blocks all cards with duplicate ids after overlays", (t) => {
  const project = createProject();
  t.after(project.cleanup);

  for (const slug of ["dup-a", "dup-b"]) {
    project.write(
      `pm/backlog/${slug}.md`,
      fm({
        type: "backlog",
        id: "PM-050",
        title: slug,
        kind: "task",
        status: "planned",
        implementation_approved: "true",
        approved_by: "soelinmyat",
        approved_at: "2026-06-23",
        updated: "2026-06-22",
      }) + "body"
    );
  }
  writeJsonAtomic(path.join(project.pmDir, "loop", "session-snapshots", "pm-050.json"), {
    card_id: "PM-050",
    title: "Duplicate overlay",
    stage: "review",
    updated_at: "2026-06-22T23:00:00Z",
  });

  const board = buildLoopBoard(project.root, { now: FIXED_NOW });

  assert.deepEqual(ids(board.columns.ready_for_dev), []);
  assert.deepEqual(ids(board.columns.reviewing), []);
  assert.equal(board.columns.blocked.length, 2);
  assert.ok(board.columns.blocked.every((card) => /duplicate card id/.test(card.blocker)));
});
