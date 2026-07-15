"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const {
  buildBoardPayload,
  renderPage,
  createServer,
  humanizeBlocker,
  blockerLevel,
} = require("../scripts/board-server.js");
const { writeJsonAtomic, cleanGitEnv } = require("../scripts/loop-git.js");

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    env: cleanGitEnv(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

// Turn a project into a git repo with a bare origin, main pushed and tracked.
function initGitWithRemote(project) {
  git(project.root, ["init", "-q"]);
  git(project.root, ["config", "user.name", "PM Test"]);
  git(project.root, ["config", "user.email", "pm-test@example.com"]);
  git(project.root, ["add", "-A"]);
  git(project.root, ["commit", "-q", "-m", "init"]);
  git(project.root, ["branch", "-M", "main"]);
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), "pm-board-remote-"));
  git(project.root, ["init", "--bare", "-q", remote]);
  git(project.root, ["remote", "add", "origin", remote]);
  git(project.root, ["push", "-q", "-u", "origin", "main"]);
  // Pin the bare remote's default branch to main. Without this, a runner whose
  // git defaults init.defaultBranch=master (unset default; GitHub ubuntu runners)
  // leaves the bare HEAD pointing at the never-pushed `master`, so `git clone`
  // checks out no branch and produces an empty working tree.
  git(remote, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  return remote;
}

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
function request(port, method, reqPath, headers, body) {
  return new Promise((resolve, reject) => {
    const options = { host: "127.0.0.1", port, method, path: reqPath, headers: headers || {} };
    const req = http.request(options, (res) => {
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

// Same-origin browser fetch and CLI clients both send this header; a cross-site
// page cannot set it without a CORS preflight the server never approves.
const TRUSTED = { "x-pm-board": "1" };

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

  // Lease detection with age + holder/runtime (E1: "which machine/engine").
  const leased = byId.get("PM-101");
  assert.ok(leased.lease, "expected an active lease on PM-101");
  assert.equal(leased.lease.holder, "machine-a");
  assert.equal(leased.lease.runtime, "codex");
  assert.equal(leased.lease.stage, "dev");
  assert.equal(leased.lease.age_seconds, 1800);

  // Loop strip present and honest about an uninstalled loop.
  assert.equal(payload.loop.paused, false);
  assert.equal(payload.loop.installed, false);
  assert.equal(payload.loop.sync, null);
  assert.ok("git" in payload);
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
  const server = createServer({
    pmDir: project.pmDir,
    runLoopControlEffect(pmDir, stopped) {
      const stopPath = path.join(pmDir, "loop", "STOP");
      if (stopped) {
        fs.mkdirSync(path.dirname(stopPath), { recursive: true });
        fs.writeFileSync(stopPath, "stop\n");
      } else fs.rmSync(stopPath, { force: true });
      return {
        state: "verified",
        effect_id: `effect_${"a".repeat(64)}`,
        verified_receipt: { stopped, authoritative_remote: true },
        recovery: { code: "inspect-loop-control-effect", command: "/pm:loop status" },
      };
    },
  });
  const { port } = await listen(server);

  const before = await request(port, "GET", "/api/board");
  assert.equal(before.json.loop.paused, false);

  const toggled = await request(port, "POST", "/api/loop/toggle", TRUSTED);
  assert.equal(toggled.json.paused, true);
  assert.equal(toggled.json.sync.state, "verified");
  assert.equal(toggled.json.sync.verified_receipt.authoritative_remote, true);
  assert.ok(fs.existsSync(path.join(project.pmDir, "loop", "STOP")));

  const paused = await request(port, "GET", "/api/board");
  assert.equal(paused.json.loop.paused, true);

  const resumed = await request(port, "POST", "/api/loop/toggle", TRUSTED);
  assert.equal(resumed.json.paused, false);
  assert.ok(!fs.existsSync(path.join(project.pmDir, "loop", "STOP")));

  const active = await request(port, "GET", "/api/board");
  assert.equal(active.json.loop.paused, false);

  server.close();
  project.cleanup();
});

test("POST /api/loop/toggle rejects cross-origin and header-less requests (CSRF)", async () => {
  const project = createProject();
  project.write("pm/backlog/task.md", approvedCard("PM-001", "Task"));
  const server = createServer({ pmDir: project.pmDir });
  const { port } = await listen(server);

  // No custom header → rejected (a simple cross-site POST cannot set it).
  const bare = await request(port, "POST", "/api/loop/toggle");
  assert.equal(bare.status, 403);

  // Cross-origin browser fetch → rejected even with the header.
  const crossOrigin = await request(port, "POST", "/api/loop/toggle", {
    "x-pm-board": "1",
    origin: "http://evil.example.com",
  });
  assert.equal(crossOrigin.status, 403);

  // A rebound attacker Host (not loopback) → rejected.
  const rebind = await request(port, "POST", "/api/loop/toggle", {
    "x-pm-board": "1",
    host: "evil.example.com",
  });
  assert.equal(rebind.status, 403);

  // The kill switch was never written by any rejected request.
  assert.ok(!fs.existsSync(path.join(project.pmDir, "loop", "STOP")));

  server.close();
  project.cleanup();
});

test("renderPage output is inert HTML with no external references", () => {
  const html = renderPage();
  assert.match(html, /PM Board/i);
  assert.match(html, /origin state is ambiguous.*recovery.*command.*\/pm:loop status/s);
  assert.doesNotMatch(html, /https?:\/\//);
  assert.doesNotMatch(html, /<script\s+src=/i);
  assert.doesNotMatch(html, /<link\b/i);
});

test("A1: a non-loopback Host is rejected on ALL routes (not just the toggle)", async () => {
  const project = createProject();
  project.write("pm/backlog/task.md", approvedCard("PM-001", "Task"));
  const server = createServer({ pmDir: project.pmDir });
  const { port } = await listen(server);

  // Loopback default Host works.
  assert.equal((await request(port, "GET", "/api/board")).status, 200);

  // DNS-rebind: attacker Host must not read the board or the page.
  const board = await request(port, "GET", "/api/board", { host: "attacker.example" });
  const page = await request(port, "GET", "/", { host: "attacker.example" });
  assert.equal(board.status, 403);
  assert.equal(page.status, 403);

  server.close();
  project.cleanup();
});

test("A2: GET / carries anti-clickjacking headers", async () => {
  const project = createProject();
  const server = createServer({ pmDir: project.pmDir });
  const { port } = await listen(server);

  const res = await request(port, "GET", "/");
  server.close();
  project.cleanup();

  assert.equal(res.headers["x-frame-options"], "DENY");
  assert.match(res.headers["content-security-policy"] || "", /frame-ancestors 'none'/);
});

test("B1: a malformed pm/loop/config.json degrades the loop section, never crashes", async () => {
  const project = createProject();
  project.write("pm/backlog/task.md", approvedCard("PM-001", "Task"));
  project.write("pm/loop/config.json", "{ this is not valid json ");
  const server = createServer({ pmDir: project.pmDir });
  const { port } = await listen(server);

  const first = await request(port, "GET", "/api/board");
  assert.equal(first.status, 200);
  assert.equal(first.json.error, undefined, "board still renders");
  assert.equal(typeof first.json.loop.error, "string", "loop section reports the bad config");
  assert.deepEqual(columnCards(first.json, "ready_for_dev"), ["PM-001"]);

  // Server is still alive after the bad-config request.
  const second = await request(port, "GET", "/api/board");
  assert.equal(second.status, 200);

  server.close();
  project.cleanup();
});

test("read-only board requests never fetch or mutate remote-tracking refs", async () => {
  const project = createProject();
  project.write("pm/backlog/task.md", approvedCard("PM-001", "Task"));
  const remote = initGitWithRemote(project);

  // Another machine pushes ahead of us via a second clone.
  const clone = fs.mkdtempSync(path.join(os.tmpdir(), "pm-board-clone-"));
  git(clone, ["clone", "-q", remote, clone]);
  git(clone, ["config", "user.name", "PM Other"]);
  git(clone, ["config", "user.email", "other@example.com"]);
  fs.writeFileSync(path.join(clone, "pm", "backlog", "task2.md"), approvedCard("PM-002", "Task 2"));
  git(clone, ["add", "-A"]);
  git(clone, ["commit", "-q", "-m", "remote work"]);
  git(clone, ["push", "-q"]);

  const headBefore = git(project.root, ["rev-parse", "HEAD"]);
  const originBefore = git(project.root, ["rev-parse", "refs/remotes/origin/main"]);
  const server = createServer({ pmDir: project.pmDir });
  const { port } = await listen(server);

  const response = await request(port, "GET", "/api/board");

  server.close();
  const headAfter = git(project.root, ["rev-parse", "HEAD"]);
  const originAfter = git(project.root, ["rev-parse", "refs/remotes/origin/main"]);
  fs.rmSync(clone, { recursive: true, force: true });
  fs.rmSync(remote, { recursive: true, force: true });
  project.cleanup();

  assert.equal(response.json.git.available, true);
  assert.equal(response.json.git.observation, "local-refs-only");
  assert.equal(response.json.git.refresh_action, "/pm:sync status");
  assert.equal(headAfter, headBefore, "GET must not move HEAD or mutate the working tree");
  assert.equal(originAfter, originBefore, "GET must not fetch or move remote-tracking refs");
});

test("A3: toggle pushes the kill switch to origin and surfaces the push result", async () => {
  const project = createProject();
  project.write("pm/backlog/task.md", approvedCard("PM-001", "Task"));
  const remote = initGitWithRemote(project);

  const server = createServer({ pmDir: project.pmDir });
  const { port } = await listen(server);

  const toggled = await request(port, "POST", "/api/loop/toggle", TRUSTED);
  assert.equal(toggled.json.paused, true);
  assert.equal(toggled.json.sync.state, "verified");
  assert.equal(toggled.json.sync.verified_receipt.receipt.authoritative_remote, true);

  server.close();
  // The kill switch actually reached origin — the "halt every machine" guarantee.
  const tree = git(project.root, ["ls-tree", "-r", "--name-only", "origin/main"]);
  fs.rmSync(remote, { recursive: true, force: true });
  project.cleanup();

  assert.match(tree, /pm\/loop\/STOP/);
});

test("D3/D8: blocker copy is humanized and levelled at the source", () => {
  // Routine pipeline waits are levelled "wait" and read as prose.
  assert.equal(blockerLevel({ blocker: "waiting on earlier sibling(s): currency-api" }), "wait");
  assert.equal(
    humanizeBlocker("waiting on earlier sibling(s): currency-api"),
    "Waiting on earlier work: currency-api"
  );
  assert.equal(blockerLevel({ blocker: "epic umbrella: waiting on children (1/3 done)" }), "wait");
  assert.equal(
    humanizeBlocker("epic umbrella: waiting on children (1/3 done)"),
    "Waiting on children — 1/3 done"
  );

  // Real problems keep the alarm level and drop raw key:value copy.
  assert.equal(
    blockerLevel({ blocker: "implementation_approved: true required before loop can start dev" }),
    "problem"
  );
  assert.equal(
    humanizeBlocker("implementation_approved: true required before loop can start dev"),
    "Needs approval before dev can start"
  );
  assert.equal(blockerLevel({ blocker: null }), null);
  assert.equal(humanizeBlocker(null), null);
});

test("stored blocker remediation and run ID are present in board payload and page rendering", () => {
  const project = createProject();
  project.write(
    "pm/backlog/blocked.md",
    approvedCard("PM-404", "Blocked task").replace(
      "status: planned",
      [
        "status: needs-human",
        'blocker_code: "failed-contract"',
        'blocker_reason: "Remote evidence could not be verified"',
        'blocker_remediation: "Run /pm:loop reconcile after GitHub recovers."',
        'loop_run_id: "loop-123"',
      ].join("\n")
    )
  );

  const payload = buildBoardPayload({ pmDir: project.pmDir, now: FIXED_NOW });
  const card = payload.cards.find((row) => row.id === "PM-404");
  project.cleanup();

  assert.equal(card.blocker_remediation, "Run /pm:loop reconcile after GitHub recovers.");
  assert.equal(card.run_id, "loop-123");
  const html = require("../scripts/board-server.js").renderPage();
  assert.match(html, /card\.blocker_remediation/);
  assert.match(html, /card\.run_id/);
});
