#!/usr/bin/env node
"use strict";

// pm:board — a local, read-only Kanban view of the git-backed loop board.
//
// Node stdlib only (http, fs, path). The board reuses the EXISTING model in
// loop-board.js (columns, cards, leases, family rules) and loop-worker.js (the
// .pm/loop-runs ledger + kill switch). It never edits backlog frontmatter; the
// single mutating endpoint flips the loop kill switch via the same mechanism
// loop-install.js uses.
//
// Binds 127.0.0.1 ONLY. Endpoints:
//   GET  /             → one self-contained HTML page (inline CSS + JS)
//   GET  /api/board    → JSON {columns, cards, loop, generated_at} | {error}
//   POST /api/loop/toggle → flips pm/loop/STOP (the only mutation)

const http = require("http");
const fs = require("fs");
const path = require("path");

const { buildLoopBoard, COLUMN_ORDER } = require("./loop-board.js");
const { parseFrontmatter } = require("./kb-frontmatter.js");
const { loadLoopConfig, configPath } = require("./loop-config.js");
const { parseCliArgs } = require("./loop-args.js");
const { findGitRoot, runGit } = require("./loop-git.js");
const { setKillSwitch } = require("./loop-install.js");
const { isStopped, readLedgers, runsDirFor, countRunsToday } = require("./loop-worker.js");

const DEFAULT_PORT = 4400;
const POLL_MS = 5000;
const MAX_RUNS_SHOWN = 10;

// Left-to-right pipeline order for display. Any column the model adds later
// that we don't list here is appended so the board never silently drops one.
const PREFERRED_ORDER = [
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
];

function displayColumnOrder() {
  const known = new Set(COLUMN_ORDER);
  const ordered = PREFERRED_ORDER.filter((name) => known.has(name));
  const extras = COLUMN_ORDER.filter((name) => !PREFERRED_ORDER.includes(name));
  return [...ordered, ...extras];
}

// --- PR link derivation --------------------------------------------------

function parseGitHubRemote(remoteUrl) {
  if (typeof remoteUrl !== "string" || !remoteUrl) return null;
  const url = remoteUrl.trim();
  // git@github.com:owner/repo(.git) or ssh/https github.com/owner/repo(.git)
  const ssh = url.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
  const https = url.match(/^https?:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/);
  const match = ssh || https;
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

function resolveRemoteUrl(pmDir) {
  const gitRoot = findGitRoot(pmDir);
  if (!gitRoot) return null;
  try {
    return runGit(["remote", "get-url", "origin"], gitRoot) || null;
  } catch {
    return null;
  }
}

function normalizePrs(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

// A PR ref may already be a full URL, or a short ref like "#42"/"42". Turn it
// into an absolute GitHub URL when the origin remote is a known GitHub repo;
// otherwise leave href null and let the UI show the raw ref.
function prHref(raw, remote) {
  if (/^https?:\/\//.test(raw)) return raw;
  if (!remote) return null;
  const num = String(raw).match(/(\d+)/);
  if (!num) return null;
  return `https://github.com/${remote.owner}/${remote.repo}/pull/${num[1]}`;
}

// --- Card enrichment -----------------------------------------------------

// `size` and `prs` are display-only fields the base board model does not carry,
// so read them straight from the card's own frontmatter (never re-derive the
// column). Returns {} when the source file is absent or unparseable.
function readDisplayFrontmatter(card) {
  if (!card.sourcePath || !card.sourcePath.endsWith(".md")) return {};
  try {
    const { data } = parseFrontmatter(fs.readFileSync(card.sourcePath, "utf8"));
    return data || {};
  } catch {
    return {};
  }
}

function leaseView(lease, now) {
  if (!lease) return null;
  const claimedMs = Date.parse(lease.claimed_at || "");
  const ageSeconds = Number.isNaN(claimedMs)
    ? null
    : Math.max(0, Math.round((now.getTime() - claimedMs) / 1000));
  return {
    stage: lease.stage || null,
    holder: lease.holder || null,
    runtime: lease.runtime || null,
    claimed_at: lease.claimed_at || null,
    expires_at: lease.expires_at || null,
    age_seconds: ageSeconds,
  };
}

function enrichCard(card, remote, now) {
  const fm = readDisplayFrontmatter(card);
  const prs = normalizePrs(fm.prs);
  return {
    id: card.id,
    slug: card.slug,
    title: card.title,
    kind: card.kind || null,
    size: typeof fm.size === "string" ? fm.size : fm.size ? String(fm.size) : null,
    status: card.status || null,
    priority: card.priority || null,
    parent: card.parent || null,
    children: Array.isArray(card.childrenSlugs) ? card.childrenSlugs : [],
    branch: card.branch || null,
    prs,
    prLinks: prs.map((raw) => ({ raw, href: prHref(raw, remote) })),
    column: card.column,
    blocker: card.blocker || null,
    command: card.command || null,
    origin: card.origin || null,
    updated_epoch: card.updatedEpoch || 0,
    updated_at: card.updatedEpoch ? new Date(card.updatedEpoch * 1000).toISOString() : null,
    lease: leaseView(card.lease, now),
  };
}

// --- Ledger / budget summary ---------------------------------------------

function ledgerDuration(record) {
  const start = Date.parse(record.started_at || "");
  const end = Date.parse(record.ended_at || "");
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(0, Math.round((end - start) / 1000));
}

function recentRuns(runsDir) {
  return readLedgers(runsDir)
    .filter((record) => record.run_id || record.started_at)
    .sort((a, b) => String(b.started_at || "").localeCompare(String(a.started_at || "")))
    .slice(0, MAX_RUNS_SHOWN)
    .map((record) => ({
      run_id: record.run_id || null,
      card_id: (record.card && record.card.id) || null,
      card_title: (record.card && record.card.title) || null,
      stage: record.stage || null,
      outcome: record.status || null,
      started_at: record.started_at || null,
      ended_at: record.ended_at || null,
      duration_seconds: ledgerDuration(record),
    }));
}

function loopSummary(pmDir, pmStateDir, now) {
  const installed = fs.existsSync(configPath(pmDir));
  const config = loadLoopConfig(pmDir);
  const runsDir = runsDirFor({ pmStateDir });
  const budgets = config.budgets || {};
  return {
    installed,
    paused: isStopped(pmDir),
    runs: recentRuns(runsDir),
    budgets: {
      runs_today: countRunsToday(runsDir, now),
      max_runs_per_day: Number(budgets.max_runs_per_day) || 12,
      ship_cycles_today: countRunsToday(runsDir, now, { stage: "ship" }),
      max_ship_cycles_per_day: Number(budgets.max_ship_cycles_per_day) || 24,
    },
  };
}

// --- Board payload -------------------------------------------------------

function stateDirFor(pmDir, sourceDir) {
  if (sourceDir) return path.join(path.resolve(sourceDir), ".pm");
  return path.join(path.dirname(path.resolve(pmDir)), ".pm");
}

function buildBoardPayload(options = {}) {
  const pmDir = path.resolve(options.pmDir || path.join(process.cwd(), "pm"));
  const now = options.now instanceof Date ? options.now : new Date();

  if (!fs.existsSync(pmDir)) {
    return {
      error: `No pm/ directory found at ${pmDir}. Run /pm:setup or /pm:start to create one.`,
      pm_dir: pmDir,
      generated_at: now.toISOString(),
    };
  }

  const pmStateDir = options.pmStateDir || stateDirFor(pmDir, options.sourceDir);
  const remote =
    options.remote !== undefined ? options.remote : parseGitHubRemote(resolveRemoteUrl(pmDir));

  let board;
  try {
    board = buildLoopBoard(path.dirname(pmDir), { pmDir, sourceDir: options.sourceDir, now });
  } catch (err) {
    return {
      error: `Could not read the board at ${pmDir}: ${err.message}`,
      pm_dir: pmDir,
      generated_at: now.toISOString(),
    };
  }

  const cards = board.cards.map((card) => enrichCard(card, remote, now));
  const columns = displayColumnOrder().map((name) => ({
    name,
    cards: (board.columns[name] || []).map((card) => card.id),
  }));

  return {
    generated_at: board.meta.generatedAt,
    pm_dir: pmDir,
    columns,
    cards,
    loop: loopSummary(pmDir, pmStateDir, now),
  };
}

// --- Toggle (the only mutation) ------------------------------------------

function toggleLoop(pmDir) {
  const resolved = path.resolve(pmDir);
  if (!fs.existsSync(resolved)) {
    return { error: `No pm/ directory found at ${resolved}.` };
  }
  const nextStopped = !isStopped(resolved);
  const result = setKillSwitch(resolved, nextStopped);
  return { paused: nextStopped, stop_path: result.stopPath, committed: result.committed };
}

// --- HTTP server ---------------------------------------------------------

// A 127.0.0.1 bind is still reachable from any page in the user's browser, so
// the mutating endpoint must defend against drive-by CSRF and DNS rebinding:
//   - Host header hostname must be loopback (a rebound attacker domain is not),
//   - any Origin present must also be loopback (blocks cross-site fetch/form),
//   - a custom header is required, which forces a CORS preflight the server
//     never satisfies — closing the gap where a browser omits Origin.
// Non-browser clients (curl, the test suite) simply send the header and a
// loopback Host, so they are unaffected.
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const BOARD_HEADER = "x-pm-board";

function hostnameOf(hostHeader) {
  const value = String(hostHeader || "").trim();
  if (!value) return "";
  if (value.startsWith("[")) return value.slice(1, value.indexOf("]")); // [::1]:port
  return value.split(":")[0];
}

function isTrustedLocalRequest(req) {
  if (!LOCAL_HOSTS.has(hostnameOf(req.headers.host))) return false;
  const origin = req.headers.origin;
  if (origin) {
    let originHost;
    try {
      originHost = new URL(origin).hostname;
    } catch {
      return false;
    }
    if (!LOCAL_HOSTS.has(originHost)) return false;
  }
  return req.headers[BOARD_HEADER] === "1";
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

function createServer(serverOptions = {}) {
  const pmDir = path.resolve(serverOptions.pmDir || path.join(process.cwd(), "pm"));
  const sourceDir = serverOptions.sourceDir;
  const pmStateDir = serverOptions.pmStateDir || stateDirFor(pmDir, sourceDir);
  const page = renderPage();

  // Resolve the origin remote once per process: it does not change while the
  // server runs, and this keeps the 5s poll from shelling out to git each time.
  let remoteResolved = false;
  let remote = null;
  function getRemote() {
    if (!remoteResolved) {
      remote = parseGitHubRemote(resolveRemoteUrl(pmDir));
      remoteResolved = true;
    }
    return remote;
  }

  return http.createServer((req, res) => {
    const url = (req.url || "/").split("?")[0];

    if (req.method === "GET" && (url === "/" || url === "/index.html")) {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(page);
      return;
    }

    if (req.method === "GET" && url === "/api/board") {
      const payload = buildBoardPayload({ pmDir, sourceDir, pmStateDir, remote: getRemote() });
      sendJson(res, 200, payload);
      return;
    }

    if (req.method === "POST" && url === "/api/loop/toggle") {
      if (!isTrustedLocalRequest(req)) {
        sendJson(res, 403, {
          error: "Forbidden: the loop toggle only accepts same-origin local requests.",
        });
        return;
      }
      // Drain the request body (may be empty) before acting.
      req.on("data", () => {});
      req.on("end", () => {
        try {
          sendJson(res, 200, toggleLoop(pmDir));
        } catch (err) {
          sendJson(res, 500, { error: err.message });
        }
      });
      return;
    }

    sendJson(res, 404, { error: `Not found: ${req.method} ${url}` });
  });
}

// --- The page ------------------------------------------------------------
//
// One self-contained document: inline CSS + JS, no external requests beyond
// same-origin fetches to /api/*. Cards render client-side from /api/board so
// the served HTML never embeds an external (e.g. GitHub) URL.
function renderPage() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>PM Board</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #0f1115;
    --panel: #171a21;
    --panel-2: #1e222b;
    --border: #2a2f3a;
    --text: #e6e9ef;
    --muted: #9aa4b2;
    --accent: #4f8cff;
    --ok: #3fb950;
    --warn: #d29922;
    --bad: #f85149;
    --chip: #262b36;
  }
  @media (prefers-color-scheme: light) {
    :root {
      --bg: #f6f7f9;
      --panel: #ffffff;
      --panel-2: #f0f2f5;
      --border: #d8dce3;
      --text: #1c2128;
      --muted: #5b6470;
      --chip: #eaedf2;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  header {
    display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
    padding: 12px 16px; border-bottom: 1px solid var(--border);
    background: var(--panel); position: sticky; top: 0; z-index: 5;
  }
  header h1 { font-size: 15px; margin: 0; font-weight: 650; letter-spacing: .2px; }
  header .spacer { flex: 1; }
  .pill {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 3px 9px; border-radius: 999px; font-size: 12px;
    background: var(--chip); color: var(--muted); border: 1px solid var(--border);
  }
  .pill.active { color: var(--ok); }
  .pill.paused { color: var(--warn); }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
  button {
    font: inherit; cursor: pointer; color: var(--text);
    background: var(--panel-2); border: 1px solid var(--border);
    border-radius: 6px; padding: 5px 12px;
  }
  button:hover { border-color: var(--accent); }
  button:disabled { opacity: .5; cursor: default; }
  #strip {
    display: flex; gap: 18px; flex-wrap: wrap; align-items: center;
    padding: 8px 16px; border-bottom: 1px solid var(--border);
    background: var(--panel); color: var(--muted); font-size: 12px;
  }
  #strip b { color: var(--text); font-weight: 600; }
  .board { display: flex; gap: 12px; padding: 16px; overflow-x: auto; align-items: flex-start; }
  .col {
    flex: 0 0 272px; background: var(--panel); border: 1px solid var(--border);
    border-radius: 10px; display: flex; flex-direction: column; max-height: calc(100vh - 150px);
  }
  .col > h2 {
    margin: 0; padding: 10px 12px; font-size: 12px; text-transform: uppercase;
    letter-spacing: .6px; color: var(--muted); border-bottom: 1px solid var(--border);
    display: flex; justify-content: space-between; position: sticky; top: 0; background: var(--panel);
  }
  .col .count { color: var(--text); }
  .cards { padding: 10px; display: flex; flex-direction: column; gap: 10px; overflow-y: auto; }
  .card {
    background: var(--panel-2); border: 1px solid var(--border); border-radius: 8px;
    padding: 10px; display: flex; flex-direction: column; gap: 7px;
  }
  .card .top { display: flex; gap: 8px; align-items: baseline; }
  .card .id { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: var(--muted); }
  .card .title { font-weight: 600; font-size: 13px; }
  .badges { display: flex; gap: 6px; flex-wrap: wrap; }
  .badge {
    font-size: 10.5px; padding: 1.5px 7px; border-radius: 999px;
    background: var(--chip); color: var(--muted); border: 1px solid var(--border);
  }
  .badge.kind { color: var(--accent); }
  .badge.running { color: var(--ok); border-color: var(--ok); }
  .badge.parent { color: var(--warn); }
  .meta { font-size: 11.5px; color: var(--muted); display: flex; flex-wrap: wrap; gap: 8px; }
  .branch { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .prs a, .prs span { color: var(--accent); text-decoration: none; margin-right: 6px; }
  .prs a:hover { text-decoration: underline; }
  .blocker { font-size: 11.5px; color: var(--bad); }
  .runs { display: flex; flex-direction: column; gap: 3px; }
  .run { font-size: 11.5px; color: var(--muted); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .run .completed { color: var(--ok); }
  .run .failed, .run .timeout, .run .rejected { color: var(--bad); }
  .empty { color: var(--muted); padding: 8px 4px; font-size: 12px; }
  #error { display: none; margin: 16px; padding: 14px 16px; border-radius: 8px;
    background: var(--panel); border: 1px solid var(--bad); color: var(--text); }
  #error.show { display: block; }
</style>
</head>
<body>
<header>
  <h1>PM Board</h1>
  <span id="loopState" class="pill"><span class="dot"></span><span>loop</span></span>
  <button id="toggle" disabled>Toggle loop</button>
  <span class="spacer"></span>
  <span id="refreshed" class="pill">—</span>
</header>
<div id="strip"></div>
<div id="error"></div>
<div id="board" class="board"></div>
<!-- pm:board — read-only Kanban over the git-backed loop board. -->
<script>
(function () {
  var POLL_MS = ${POLL_MS};
  var boardEl = document.getElementById("board");
  var stripEl = document.getElementById("strip");
  var errorEl = document.getElementById("error");
  var loopStateEl = document.getElementById("loopState");
  var refreshedEl = document.getElementById("refreshed");
  var toggleBtn = document.getElementById("toggle");
  var paused = false;
  var busy = false;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function ago(seconds) {
    if (seconds == null) return "";
    var s = Math.max(0, seconds);
    if (s < 60) return s + "s";
    if (s < 3600) return Math.floor(s / 60) + "m";
    if (s < 86400) return Math.floor(s / 3600) + "h";
    return Math.floor(s / 86400) + "d";
  }
  function relAge(iso) {
    if (!iso) return "";
    var then = Date.parse(iso);
    if (isNaN(then)) return "";
    return ago(Math.round((Date.now() - then) / 1000)) + " ago";
  }

  function cardHtml(card) {
    var badges = [];
    if (card.kind) badges.push('<span class="badge kind">' + esc(card.kind) + "</span>");
    if (card.size) badges.push('<span class="badge">' + esc(card.size) + "</span>");
    if (card.lease) {
      badges.push('<span class="badge running">running ' + esc(ago(card.lease.age_seconds)) + "</span>");
    }
    if (card.parent) badges.push('<span class="badge parent">↳ ' + esc(card.parent) + "</span>");

    var meta = [];
    if (card.branch) meta.push('<span class="branch">' + esc(card.branch) + "</span>");
    if (card.updated_at) meta.push("<span>" + esc(relAge(card.updated_at)) + "</span>");

    var prs = "";
    if (card.prLinks && card.prLinks.length) {
      prs = '<div class="prs">' + card.prLinks.map(function (p) {
        return p.href
          ? '<a href="' + esc(p.href) + '" target="_blank" rel="noopener">' + esc(p.raw) + "</a>"
          : "<span>" + esc(p.raw) + "</span>";
      }).join("") + "</div>";
    }

    return '<div class="card">' +
      '<div class="top"><span class="id">' + esc(card.id) + "</span></div>" +
      '<div class="title">' + esc(card.title) + "</div>" +
      (badges.length ? '<div class="badges">' + badges.join("") + "</div>" : "") +
      (meta.length ? '<div class="meta">' + meta.join("") + "</div>" : "") +
      prs +
      (card.blocker ? '<div class="blocker">⚠ ' + esc(card.blocker) + "</div>" : "") +
      "</div>";
  }

  function render(data) {
    if (data.error) {
      errorEl.textContent = data.error;
      errorEl.className = "show";
      boardEl.innerHTML = "";
      stripEl.innerHTML = "";
      loopStateEl.style.display = "none";
      toggleBtn.disabled = true;
      return;
    }
    errorEl.className = "";
    loopStateEl.style.display = "";

    var byId = {};
    (data.cards || []).forEach(function (c) { byId[c.id] = c; });

    boardEl.innerHTML = (data.columns || []).map(function (col) {
      var cards = (col.cards || []).map(function (id) { return byId[id]; }).filter(Boolean);
      var body = cards.length
        ? cards.map(cardHtml).join("")
        : '<div class="empty">—</div>';
      return '<div class="col"><h2><span>' + esc(col.name.replace(/_/g, " ")) +
        '</span><span class="count">' + cards.length + "</span></h2>" +
        '<div class="cards">' + body + "</div></div>";
    }).join("");

    var loop = data.loop || {};
    paused = !!loop.paused;
    loopStateEl.className = "pill " + (paused ? "paused" : (loop.installed ? "active" : ""));
    loopStateEl.innerHTML = '<span class="dot"></span><span>' +
      (loop.installed ? (paused ? "loop paused" : "loop active") : "loop not installed") + "</span>";
    toggleBtn.disabled = busy;
    toggleBtn.textContent = paused ? "Resume loop" : "Pause loop";

    var b = loop.budgets || {};
    var stripParts = [
      "<span>runs today <b>" + (b.runs_today || 0) + " / " + (b.max_runs_per_day || 0) + "</b></span>",
      "<span>ship cycles <b>" + (b.ship_cycles_today || 0) + " / " + (b.max_ship_cycles_per_day || 0) + "</b></span>",
    ];
    var runs = loop.runs || [];
    if (runs.length) {
      stripParts.push('<span class="runs">' + runs.map(function (r) {
        var dur = r.duration_seconds != null ? " " + ago(r.duration_seconds) : "";
        return '<span class="run">' + esc(r.card_id || "?") + " · " + esc(r.stage || "?") +
          ' · <span class="' + esc(r.outcome || "") + '">' + esc(r.outcome || "?") + "</span>" + esc(dur) + "</span>";
      }).join("") + "</span>");
    } else {
      stripParts.push('<span class="run">no runs recorded yet</span>');
    }
    stripEl.innerHTML = stripParts.join("");
  }

  function refresh() {
    fetch("/api/board", { headers: { accept: "application/json" } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        render(data);
        refreshedEl.textContent = "updated " + new Date().toLocaleTimeString();
      })
      .catch(function (err) {
        refreshedEl.textContent = "offline — " + new Date().toLocaleTimeString();
        errorEl.textContent = "Cannot reach the board server: " + err;
        errorEl.className = "show";
      });
  }

  toggleBtn.addEventListener("click", function () {
    if (busy) return;
    busy = true;
    toggleBtn.disabled = true;
    fetch("/api/loop/toggle", { method: "POST", headers: { "x-pm-board": "1" } })
      .then(function (r) { return r.json(); })
      .then(function () { busy = false; refresh(); })
      .catch(function () { busy = false; refresh(); });
  });

  refresh();
  setInterval(refresh, POLL_MS);
})();
</script>
</body>
</html>
`;
}

// --- CLI -----------------------------------------------------------------

function parseArgs(argv) {
  const defaults = {
    port: DEFAULT_PORT,
    pmDir: path.join(process.cwd(), "pm"),
    sourceDir: "",
  };
  const { args } = parseCliArgs(
    argv,
    {
      "--port": { key: "port", type: "string" },
      "--pm-dir": { key: "pmDir", type: "string" },
      "--source-dir": { key: "sourceDir", type: "string" },
    },
    defaults
  );
  args.port = Number(args.port) || DEFAULT_PORT;
  args.pmDir = path.resolve(args.pmDir);
  if (args.sourceDir) args.sourceDir = path.resolve(args.sourceDir);
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const server = createServer({ pmDir: args.pmDir, sourceDir: args.sourceDir || undefined });
  // 127.0.0.1 ONLY — never 0.0.0.0. This board is a local visibility tool and
  // exposes a loop kill-switch mutation; it must not be reachable off-host.
  server.listen(args.port, "127.0.0.1", () => {
    process.stdout.write(`pm:board → http://127.0.0.1:${args.port}  (pm: ${args.pmDir})\n`);
    if (!fs.existsSync(args.pmDir)) {
      process.stdout.write(
        `  note: ${args.pmDir} does not exist yet — the page will show setup help.\n`
      );
    }
  });
  server.on("error", (err) => {
    process.stderr.write(`board-server: ${err.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  buildBoardPayload,
  createServer,
  displayColumnOrder,
  enrichCard,
  isTrustedLocalRequest,
  parseGitHubRemote,
  prHref,
  renderPage,
  toggleLoop,
};

if (require.main === module) {
  main();
}
