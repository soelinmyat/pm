"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { buildBoardPayload, renderPage, createServer } = require("../scripts/board-server.js");
const { writeJsonAtomic } = require("../scripts/loop-git.js");

const FIXED_NOW = new Date("2026-06-23T00:00:00Z");

function createProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-board-server-"));
  const project = {
    root,
    pmDir: path.join(root, "pm"),
    stateDir: path.join(root, ".pm"),
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

function columnCards(payload, name) {
  const column = payload.columns.find((col) => col.name === name);
  return column ? column.cards : undefined;
}

// Fire an HTTP request against a server already listening on 127.0.0.1.
function request(port, method, reqPath, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path: reqPath }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        let json;
        try {
          json = JSON.parse(data);
        } catch {
          json = undefined;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: data, json });
      });
    });
    req.on("error", reject);
    if (body !== undefined) req.write(typeof body === "string" ? body : JSON.stringify(body));
    req.end();
  });
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address()));
  });
}

test("GET /api/board payload shape: columns, cards, parent grouping, lease detection", () => {
  const project = createProject();

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
    approvedCard(
      "PM-101",
      "API slice",
      ['parent: "currency"', 'size: "M"', 'prs: ["#42"]'].join("\n")
    )
  );
  project.write(
    "pm/backlog/currency-ui.md",
    approvedCard("PM-102", "UI slice", 'parent: "currency"')
  );
  // Active dev lease on the first child → it should land in `implementing`.
  writeJsonAtomic(path.join(project.pmDir, "loop", "leases", "dev-pm-101.json"), {
    version: 1,
    card_id: "PM-101",
    stage: "dev",
    holder: "machine-a",
    runtime: "codex",
    claimed_at: "2026-06-22T23:30:00Z",
    expires_at: "2026-06-23T00:30:00Z",
  });

  const payload = buildBoardPayload({ pmDir: project.pmDir, now: FIXED_NOW });
  project.cleanup();

  // Columns are an ordered array of {name, cards:[id...]} covering every model column.
  assert.ok(Array.isArray(payload.columns));
  const names = payload.columns.map((col) => col.name);
  for (const required of [
    "inbox",
    "needs_research",
    "needs_rfc",
    "ready_for_dev",
    "implementing",
    "reviewing",
    "shipping",
    "needs_human",
    "blocked",
    "done",
  ]) {
    assert.ok(names.includes(required), `missing column ${required}`);
  }

  // Leased child sits in implementing; epic umbrella + later sibling are blocked.
  assert.deepEqual(columnCards(payload, "implementing"), ["PM-101"]);
  assert.ok(columnCards(payload, "blocked").includes("PM-100"));
  assert.ok(columnCards(payload, "blocked").includes("PM-102"));

  const byId = new Map(payload.cards.map((card) => [card.id, card]));

  // Parent grouping: children carry the parent slug; the epic lists its children.
  assert.equal(byId.get("PM-101").parent, "currency");
  assert.equal(byId.get("PM-102").parent, "currency");
  assert.deepEqual(byId.get("PM-100").children, ["currency-api", "currency-ui"]);

  // Enriched display fields sourced from frontmatter (not in the base board model).
  assert.equal(byId.get("PM-101").size, "M");
  assert.deepEqual(byId.get("PM-101").prLinks, [{ raw: "#42", href: null }]);

  // Lease detection with age.
  const leased = byId.get("PM-101");
  assert.ok(leased.lease, "expected an active lease on PM-101");
  assert.equal(leased.lease.holder, "machine-a");
  assert.equal(leased.lease.stage, "dev");
  assert.equal(leased.lease.age_seconds, 1800);

  // Loop strip present and honest about an uninstalled loop.
  assert.equal(payload.loop.paused, false);
  assert.equal(payload.loop.installed, false);
  assert.ok(typeof payload.generated_at === "string");
});

test("backlog-only mode renders when no loop config is present", () => {
  const project = createProject();
  project.write("pm/backlog/task.md", approvedCard("PM-001", "Lonely task"));

  const payload = buildBoardPayload({ pmDir: project.pmDir, now: FIXED_NOW });
  project.cleanup();

  assert.equal(payload.error, undefined);
  assert.equal(payload.loop.installed, false);
  assert.deepEqual(payload.loop.runs, []);
  assert.ok(payload.loop.budgets, "budgets should still be present via defaults");
  assert.deepEqual(columnCards(payload, "ready_for_dev"), ["PM-001"]);
});

test("loop strip surfaces recent runs and today's budget usage from the ledger", () => {
  const project = createProject();
  project.write("pm/backlog/task.md", approvedCard("PM-001", "Task"));
  project.write(
    "pm/loop/config.json",
    JSON.stringify({ version: 1, budgets: { max_runs_per_day: 5 } })
  );
  writeJsonAtomic(path.join(project.stateDir, "loop-runs", "run-1.json"), {
    version: 1,
    run_id: "run-1",
    status: "completed",
    stage: "dev",
    card: { id: "PM-001", title: "Task" },
    started_at: "2026-06-23T10:00:00Z",
    ended_at: "2026-06-23T10:05:00Z",
  });

  const payload = buildBoardPayload({ pmDir: project.pmDir, now: FIXED_NOW });
  project.cleanup();

  assert.equal(payload.loop.installed, true);
  assert.equal(payload.loop.runs.length, 1);
  assert.equal(payload.loop.runs[0].outcome, "completed");
  assert.equal(payload.loop.runs[0].stage, "dev");
  assert.equal(payload.loop.runs[0].card_id, "PM-001");
  assert.equal(payload.loop.runs[0].duration_seconds, 300);
  assert.equal(payload.loop.budgets.runs_today, 1);
  assert.equal(payload.loop.budgets.max_runs_per_day, 5);
  assert.equal(payload.loop.budgets.ship_cycles_today, 0);
});

test("no pm/ dir yields an error payload but never throws", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-board-nopm-"));
  const payload = buildBoardPayload({ pmDir: path.join(root, "pm"), now: FIXED_NOW });
  fs.rmSync(root, { recursive: true, force: true });

  assert.equal(typeof payload.error, "string");
  assert.ok(payload.error.length > 0);
});

test("GET / serves a self-contained HTML page (no external resources)", async () => {
  const project = createProject();
  project.write("pm/backlog/task.md", approvedCard("PM-001", "Task"));
  const server = createServer({ pmDir: project.pmDir });
  const { port } = await listen(server);

  const res = await request(port, "GET", "/");
  server.close();
  project.cleanup();

  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /text\/html/);
  // The single served page must reference no external hosts — only same-origin
  // fetches to /api/*. Any http(s):// literal would be an external resource.
  assert.doesNotMatch(res.body, /https?:\/\//);
  assert.match(res.body, /\/api\/board/);
  assert.match(res.body, /PM Board/i);
});

test("server binds 127.0.0.1 only", async () => {
  const project = createProject();
  const server = createServer({ pmDir: project.pmDir });
  const address = await listen(server);
  assert.equal(address.address, "127.0.0.1");
  server.close();
  project.cleanup();
});

test("GET /api/board over HTTP returns JSON; missing pm dir returns error shape", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-board-http-"));
  const server = createServer({ pmDir: path.join(root, "pm") });
  const { port } = await listen(server);

  const page = await request(port, "GET", "/");
  const board = await request(port, "GET", "/api/board");
  server.close();
  fs.rmSync(root, { recursive: true, force: true });

  // Page is always served (helpful message page), server stays up.
  assert.equal(page.status, 200);
  // API surfaces the error rather than 500-ing.
  assert.ok(board.json, "expected JSON body");
  assert.equal(typeof board.json.error, "string");
});

test("POST /api/loop/toggle flips the kill switch and GET reflects it", async () => {
  const project = createProject();
  project.write("pm/backlog/task.md", approvedCard("PM-001", "Task"));
  const server = createServer({ pmDir: project.pmDir });
  const { port } = await listen(server);

  const before = await request(port, "GET", "/api/board");
  assert.equal(before.json.loop.paused, false);

  const toggled = await request(port, "POST", "/api/loop/toggle");
  assert.equal(toggled.json.paused, true);
  assert.ok(fs.existsSync(path.join(project.pmDir, "loop", "STOP")));

  const paused = await request(port, "GET", "/api/board");
  assert.equal(paused.json.loop.paused, true);

  const resumed = await request(port, "POST", "/api/loop/toggle");
  assert.equal(resumed.json.paused, false);
  assert.ok(!fs.existsSync(path.join(project.pmDir, "loop", "STOP")));

  const active = await request(port, "GET", "/api/board");
  assert.equal(active.json.loop.paused, false);

  server.close();
  project.cleanup();
});

test("renderPage output is inert HTML with no external references", () => {
  const html = renderPage();
  assert.match(html, /PM Board/i);
  assert.doesNotMatch(html, /https?:\/\//);
  assert.doesNotMatch(html, /<script\s+src=/i);
  assert.doesNotMatch(html, /<link\b/i);
});
