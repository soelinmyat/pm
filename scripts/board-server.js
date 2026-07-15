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

const { COLUMN_ORDER } = require("./loop-board.js");
const { buildOperationalSnapshot } = require("./lib/operational-read-model.js");
const { parseCliArgs } = require("./loop-args.js");
const { findGitRoot, runGit } = require("./loop-git.js");
const { loadReleaseGateState, runLoopControlEffect } = require("./loop-install.js");
const { isStopped } = require("./loop-worker.js");

const DEFAULT_PORT = 4400;
const POLL_MS = 5000;
// Explicit mutation requests are bounded so a hung push cannot freeze the
// single-threaded server indefinitely.
const PUSH_TIMEOUT_MS = 15000;
const GIT_STATUS_TIMEOUT_MS = 5000;

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

// Routine "waiting on the pipeline" states are working-as-designed and must not
// wear the same red alarm as real problems (failed runs, missing approval, hard
// blocks). The board data already distinguishes them.
function blockerLevel(card) {
  if (!card.blocker) return null;
  if (/waiting on (earlier sibling|children)/i.test(card.blocker)) return "wait";
  return "problem";
}

// Humanize blocker copy at the source so the UI never shows raw `key: value`.
function humanizeBlocker(raw) {
  if (!raw) return null;
  const direct = [
    [/implementation_approved.*required/i, "Needs approval before dev can start"],
    [/proposal requires an rfc/i, "Needs an RFC before dev can start"],
    [/all children done.*close out/i, "All children done — close out the epic"],
  ];
  for (const [pattern, text] of direct) if (pattern.test(raw)) return text;

  let m = raw.match(/waiting on children \((\d+)\/(\d+) done\)/i);
  if (m) return `Waiting on children — ${m[1]}/${m[2]} done`;
  m = raw.match(/waiting on earlier sibling\(s\):\s*(.+)/i);
  if (m) return `Waiting on earlier work: ${m[1]}`;
  m = raw.match(/duplicate card id "?([^"]+?)"?$/i);
  if (m) return `Duplicate card id: ${m[1]}`;
  return raw;
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
  // size/prs are carried on the card model now (loop-board), no re-parse.
  const prs = normalizePrs(card.prs);
  return {
    id: card.id,
    slug: card.slug,
    title: card.title,
    kind: card.kind || null,
    size: card.size || null,
    status: card.status || null,
    priority: card.priority || null,
    parent: card.parent || null,
    children: Array.isArray(card.childrenSlugs) ? card.childrenSlugs : [],
    branch: card.branch || null,
    prs,
    prLinks: prs.map((raw) => ({ raw, href: prHref(raw, remote) })),
    column: card.column,
    blocker: humanizeBlocker(card.blocker),
    blocker_level: blockerLevel(card),
    blocker_remediation: card.blockerRemediation || null,
    run_id: card.loopRunId || null,
    command: card.command || null,
    origin: card.origin || null,
    updated_epoch: card.updatedEpoch || 0,
    updated_at: card.updatedEpoch ? new Date(card.updatedEpoch * 1000).toISOString() : null,
    lease: leaseView(card.lease, now),
  };
}

// --- Ledger / budget summary ---------------------------------------------

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

  const remote =
    options.remote !== undefined ? options.remote : parseGitHubRemote(resolveRemoteUrl(pmDir));

  let snapshot;
  try {
    snapshot =
      options.snapshot ||
      buildOperationalSnapshot(path.dirname(pmDir), {
        pmDir,
        pmStateDir: options.pmStateDir,
        sourceDir: options.sourceDir,
        now,
      });
  } catch (err) {
    return {
      error: `Could not read the board at ${pmDir}: ${err.message}`,
      pm_dir: pmDir,
      generated_at: now.toISOString(),
    };
  }

  const cards = snapshot.work_items.map((card) => enrichCard(card, remote, now));
  const columns = displayColumnOrder().map((name) => ({
    name,
    cards: snapshot.columns[name] || [],
  }));

  // Belt-and-suspenders: loopSummary already degrades a bad config internally,
  // but anything unexpected here still degrades the loop section, never throws.
  let loop;
  try {
    loop = structuredClone(snapshot.loop);
    loop.sync = options.killSwitchSync || null;
  } catch (err) {
    loop = {
      installed: false,
      paused: false,
      runs: [],
      budgets: {
        runs_today: 0,
        max_runs_per_day: 12,
        ship_cycles_today: 0,
        max_ship_cycles_per_day: 24,
      },
      sync: options.killSwitchSync || null,
      error: `loop status unavailable: ${err.message}`,
    };
  }

  return {
    generated_at: snapshot.meta.generated_at,
    observation_id: snapshot.meta.observation_id,
    pm_dir: pmDir,
    columns,
    cards,
    loop,
    git: options.git || null,
    recovery_actions: snapshot.recovery_actions,
    recent_delivery: snapshot.recent_delivery,
  };
}

// --- Toggle (the only mutation) ------------------------------------------

// Execute the same journaled, authoritative control effect as pm:loop. The
// board never reports a local flip as a durable all-machine stop.
function toggleLoop(pmDir, desiredPaused, options = {}) {
  const resolved = path.resolve(pmDir);
  if (!fs.existsSync(resolved)) {
    return { error: `No pm/ directory found at ${resolved}.` };
  }
  if (typeof desiredPaused !== "boolean") {
    throw new TypeError("loop control requires an explicit paused state");
  }
  const nextStopped = desiredPaused;
  const resolvedPmStateDir = path.resolve(options.pmStateDir || stateDirFor(resolved));
  const runControl = options.runControl || runLoopControlEffect;
  let resumeState = null;
  if (!nextStopped) {
    const loadResumeState = options.loadReleaseGateState || loadReleaseGateState;
    resumeState = loadResumeState({ pmDir: resolved, pmStateDir: resolvedPmStateDir });
    if (!resumeState.releaseGate?.passed) {
      throw new Error(
        `loop remains paused until canary evidence passes: ${resumeState.releaseGate?.reason || "release gate did not pass"}`
      );
    }
  }
  const effect = runControl(resolved, nextStopped, {
    pmStateDir: resolvedPmStateDir,
    authorityActions: ["control_loop"],
    requestKey: options.requestKey,
    timeout: options.timeout || PUSH_TIMEOUT_MS,
    ...(nextStopped ? {} : { config: resumeState.config }),
  });
  return {
    paused: isStopped(resolved),
    requested_paused: nextStopped,
    sync: {
      state: effect.state,
      stopped: nextStopped,
      effect_id: effect.effect_id,
      verified_receipt: effect.verified_receipt,
      recovery: effect.recovery,
      at: new Date().toISOString(),
    },
  };
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

function readToggleIntent(req, callback) {
  const chunks = [];
  let bytes = 0;
  req.on("data", (chunk) => {
    bytes += chunk.length;
    if (bytes > 4096) req.destroy(new Error("toggle request body is too large"));
    else chunks.push(chunk);
  });
  req.on("error", (error) => callback(error));
  req.on("end", () => {
    try {
      const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!value || typeof value !== "object" || typeof value.paused !== "boolean") {
        throw new Error("toggle request requires a boolean paused field");
      }
      if (
        typeof value.idempotency_key !== "string" ||
        !/^[a-zA-Z0-9._:-]{8,128}$/.test(value.idempotency_key)
      ) {
        throw new Error("toggle request requires a valid idempotency_key");
      }
      callback(null, { paused: value.paused, key: value.idempotency_key });
    } catch (error) {
      callback(error);
    }
  });
}

// The board is a strictly read-only projection. Even `git fetch` moves
// remote-tracking refs, so GET requests inspect only already-present local refs
// and point operators to an explicit Sync command for a fresh remote view.
function makeGitFreshness(pmDir) {
  let status = null;

  function refresh() {
    const opts = { timeout: GIT_STATUS_TIMEOUT_MS };
    try {
      const gitRoot = findGitRoot(pmDir);
      if (!gitRoot) {
        status = { available: false, observation: "local-refs-only" };
        return;
      }
      const branch = runGit(["rev-parse", "--abbrev-ref", "HEAD"], gitRoot, opts);
      let upstream = null;
      let behind = null;
      let ahead = null;
      try {
        upstream = runGit(
          ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
          gitRoot,
          opts
        );
        behind = Number(runGit(["rev-list", "--count", `HEAD..${upstream}`], gitRoot, opts)) || 0;
        ahead = Number(runGit(["rev-list", "--count", `${upstream}..HEAD`], gitRoot, opts)) || 0;
      } catch {
        upstream = null;
      }
      status = {
        available: true,
        branch,
        upstream,
        behind,
        ahead,
        observation: "local-refs-only",
        observed_at: new Date().toISOString(),
        refresh_action: "/pm:sync status",
      };
    } catch (err) {
      status = {
        available: false,
        observation: "local-refs-only",
        refresh_action: "/pm:sync status",
        error: String((err && err.message) || err).slice(0, 300),
      };
    }
  }

  return {
    get: () => status,
    refresh,
  };
}

function createServer(serverOptions = {}) {
  const pmDir = path.resolve(serverOptions.pmDir || path.join(process.cwd(), "pm"));
  const sourceDir = serverOptions.sourceDir;
  const pmStateDir = serverOptions.pmStateDir || stateDirFor(pmDir, sourceDir);
  const page = renderPage();
  const gitFreshness = makeGitFreshness(pmDir);
  const toggleRequests = new Map();

  // Last kill-switch sync result, surfaced on the board so a failed push shows
  // "paused locally — push failed" instead of a silent false guarantee.
  let killSwitchSync = null;

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
    // A1: reject any non-loopback Host on EVERY route (defeats DNS rebinding
    // reads of the whole board, not just the mutating endpoint).
    if (!LOCAL_HOSTS.has(hostnameOf(req.headers.host))) {
      sendJson(res, 403, { error: "Forbidden: non-loopback Host header." });
      return;
    }

    const url = (req.url || "/").split("?")[0];

    if (req.method === "GET" && (url === "/" || url === "/index.html")) {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        // A2: this page can flip the kill switch via same-origin fetch, so it
        // must never be framed (clickjacking) — deny all ancestors.
        "x-frame-options": "DENY",
        "content-security-policy":
          "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; " +
          "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      });
      res.end(page);
      return;
    }

    if (req.method === "GET" && url === "/api/board") {
      gitFreshness.refresh();
      const payload = buildBoardPayload({
        pmDir,
        sourceDir,
        pmStateDir,
        remote: getRemote(),
        git: gitFreshness.get(),
        killSwitchSync,
      });
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
      readToggleIntent(req, (error, intent) => {
        if (error) {
          sendJson(res, 400, { error: error.message });
          return;
        }
        const prior = toggleRequests.get(intent.key);
        if (prior) {
          if (prior.requested_paused !== intent.paused) {
            sendJson(res, 409, { error: "idempotency key was already used for another state" });
          } else sendJson(res, 200, prior);
          return;
        }
        let result;
        try {
          result = toggleLoop(pmDir, intent.paused, {
            pmStateDir,
            requestKey: intent.key,
            runControl: serverOptions.runLoopControlEffect,
            loadReleaseGateState: serverOptions.loadReleaseGateState,
            timeout: PUSH_TIMEOUT_MS,
          });
        } catch (err) {
          sendJson(res, 500, { error: err.message });
          return;
        }
        if (result.sync?.state === "verified") {
          killSwitchSync = result.sync;
          toggleRequests.set(intent.key, result);
          if (toggleRequests.size > 128) toggleRequests.delete(toggleRequests.keys().next().value);
        }
        sendJson(res, 200, result);
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
      /* Status hues re-tuned for >=4.5:1 on the DARKEST light surface (the
         #eaedf2 badge chip), not just pure white — verified via WCAG contrast. */
      --accent: #0a58ca;
      --ok: #0f7331;
      --warn: #805800;
      --bad: #b8342f;
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
  .note { font-size: 12px; color: var(--muted); }
  .note.ok { color: var(--ok); }
  .note.bad { color: var(--bad); }
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
  button:focus-visible, a:focus-visible {
    outline: 2px solid var(--accent); outline-offset: 2px;
  }
  main { display: block; }
  #strip {
    display: flex; gap: 22px; flex-wrap: wrap; align-items: flex-start;
    padding: 8px 16px; border-bottom: 1px solid var(--border);
    background: var(--panel); color: var(--muted); font-size: 12px;
  }
  .strip-group { display: flex; flex-direction: column; gap: 3px; }
  .strip-group.budgets { flex-direction: row; gap: 16px; align-items: center; }
  .strip-label {
    font-size: 10px; text-transform: uppercase; letter-spacing: .7px; color: var(--muted); opacity: .8;
  }
  #strip b { color: var(--text); font-weight: 600; }
  .runs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
  .run { font-size: 11.5px; color: var(--muted); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .run-when { color: var(--text); }
  .run-outcome.completed { color: var(--ok); }
  .run-outcome.failed, .run-outcome.timeout, .run-outcome.rejected,
  .run-outcome.bootstrap-failed, .run-outcome.attempts-exhausted { color: var(--bad); }
  .board {
    list-style: none; margin: 0;
    display: flex; gap: 12px; padding: 16px; overflow-x: auto; align-items: stretch;
  }
  .col {
    flex: 0 0 272px; background: var(--panel); border: 1px solid var(--border);
    border-radius: 10px; display: flex; flex-direction: column; max-height: calc(100vh - 170px);
  }
  .col.collapsed {
    flex: 0 0 34px; align-items: center; justify-content: center; padding: 8px 0;
  }
  .col.collapsed .rail-label {
    writing-mode: vertical-rl; transform: rotate(180deg);
    text-transform: uppercase; letter-spacing: .6px; font-size: 11px; color: var(--muted); white-space: nowrap;
  }
  .col > h2 {
    margin: 0; padding: 10px 12px; font-size: 12px; text-transform: uppercase;
    letter-spacing: .6px; color: var(--muted); border-bottom: 1px solid var(--border);
    display: flex; justify-content: space-between; position: sticky; top: 0; background: var(--panel);
  }
  .col .count { color: var(--text); }
  .cards { list-style: none; margin: 0; padding: 10px; display: flex; flex-direction: column; gap: 10px; overflow-y: auto; }
  .card {
    background: var(--panel-2); border: 1px solid var(--border);
    border-left-width: 3px; border-radius: 8px;
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
  .meta { font-size: 11.5px; color: var(--muted); display: flex; flex-wrap: wrap; gap: 8px; }
  .branch { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .prs a, .prs span { color: var(--accent); text-decoration: none; margin-right: 6px; }
  .prs a:hover { text-decoration: underline; }
  .blocker { font-size: 11.5px; }
  .blocker.problem { color: var(--bad); }
  .blocker.wait { color: var(--muted); }
  .empty { color: var(--muted); padding: 8px 4px; font-size: 12px; }
  #error { display: none; margin: 16px; padding: 14px 16px; border-radius: 8px;
    background: var(--panel); border: 1px solid var(--bad); color: var(--text); }
  #error.show { display: block; }
</style>
</head>
<body>
<header>
  <h1>PM Board</h1>
  <span id="loopState" class="pill" aria-live="polite"><span class="dot"></span><span>loop</span></span>
  <button id="toggle" disabled>Toggle loop</button>
  <span id="syncNote" class="note"></span>
  <span class="spacer"></span>
  <span id="git" class="note"></span>
  <span id="refreshed" class="pill">—</span>
</header>
<main>
  <section id="strip" aria-label="loop status">
    <div id="budgets" class="strip-group budgets"></div>
    <div id="runlog" class="strip-group" aria-live="polite" aria-label="recent loop runs"></div>
  </section>
  <div id="error" role="alert"></div>
  <ul id="board" class="board"></ul>
</main>
<!-- pm:board — read-only Kanban over the git-backed loop board. -->
<script>
(function () {
  var POLL_MS = ${POLL_MS};
  var boardEl = document.getElementById("board");
  var budgetsEl = document.getElementById("budgets");
  var runlogEl = document.getElementById("runlog");
  var errorEl = document.getElementById("error");
  var loopStateEl = document.getElementById("loopState");
  var syncEl = document.getElementById("syncNote");
  var gitEl = document.getElementById("git");
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
  // Stable per-epic hue so a family reads as one group across lanes.
  function hashHue(str) {
    var h = 0;
    for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return h % 360;
  }
  function familyColor(card) {
    var key = card.children && card.children.length ? card.slug : card.parent;
    return key ? "hsl(" + hashHue(String(key)) + " 68% 52%)" : null;
  }

  function cardHtml(card) {
    var color = familyColor(card);
    var badges = [];
    if (card.kind) badges.push('<span class="badge kind">' + esc(card.kind) + "</span>");
    if (card.size) badges.push('<span class="badge">size ' + esc(card.size) + "</span>");
    if (card.lease) {
      var L = card.lease, rp = ["running"];
      if (L.holder) rp.push(esc(L.holder));
      if (L.runtime) rp.push(esc(L.runtime));
      if (L.age_seconds != null) rp.push(esc(ago(L.age_seconds)));
      badges.push('<span class="badge running">' + rp.join(" · ") + "</span>");
    }
    if (card.parent && color) {
      badges.push('<span class="badge" style="color:' + color + ';border-color:' + color + '">↳ ' + esc(card.parent) + "</span>");
    }

    var meta = [];
    if (card.branch) meta.push('<span class="branch">' + esc(card.branch) + "</span>");
    if (card.updated_at) meta.push("<span>" + esc(relAge(card.updated_at)) + "</span>");
    if (card.run_id) meta.push('<span class="branch">run ' + esc(card.run_id) + "</span>");

    var prs = "";
    if (card.prLinks && card.prLinks.length) {
      prs = '<div class="prs">' + card.prLinks.map(function (p) {
        return p.href
          ? '<a href="' + esc(p.href) + '" target="_blank" rel="noopener">' + esc(p.raw) + "</a>"
          : "<span>" + esc(p.raw) + "</span>";
      }).join("") + "</div>";
    }

    var blocker = "";
    if (card.blocker) {
      var problem = card.blocker_level === "problem";
      blocker = '<div class="blocker ' + (problem ? "problem" : "wait") + '">' +
        (problem ? "⚠ " : "⏳ ") + esc(card.blocker) + "</div>";
    }
    if (card.blocker_remediation) {
      blocker += '<div class="blocker wait">Next: ' + esc(card.blocker_remediation) + "</div>";
    }

    var style = color ? ' style="border-left-color:' + color + '"' : "";
    return '<li class="card"' + style + ">" +
      '<div class="top"><span class="id">' + esc(card.id) + "</span></div>" +
      '<div class="title">' + esc(card.title) + "</div>" +
      (badges.length ? '<div class="badges">' + badges.join("") + "</div>" : "") +
      (meta.length ? '<div class="meta">' + meta.join("") + "</div>" : "") +
      prs + blocker +
      "</li>";
  }

  function renderBoard(data, byId) {
    boardEl.innerHTML = (data.columns || []).map(function (col) {
      var cards = (col.cards || []).map(function (id) { return byId[id]; }).filter(Boolean);
      var label = esc(col.name.replace(/_/g, " "));
      if (!cards.length) {
        return '<li class="col collapsed"><span class="rail-label">' + label + " · 0</span></li>";
      }
      return '<li class="col"><h2><span>' + label +
        '</span><span class="count">' + cards.length + "</span></h2>" +
        '<ul class="cards">' + cards.map(cardHtml).join("") + "</ul></li>";
    }).join("");
  }

  function renderStrip(loop) {
    var b = loop.budgets || {};
    budgetsEl.innerHTML = '<span class="strip-label">budget</span>' +
      "<span>runs <b>" + (b.runs_today || 0) + " / " + (b.max_runs_per_day || 0) + "</b></span>" +
      "<span>ship <b>" + (b.ship_cycles_today || 0) + " / " + (b.max_ship_cycles_per_day || 0) + "</b></span>";

    var runs = loop.runs || [];
    var rows = runs.length
      ? '<ul class="runs">' + runs.map(function (r) {
          var when = relAge(r.started_at);
          var dur = r.duration_seconds != null ? " (" + ago(r.duration_seconds) + ")" : "";
          return '<li class="run"><span class="run-when">' + esc(when || "—") + "</span> · " +
            esc(r.card_id || "?") + " · " + esc(r.stage || "?") + " · " +
            '<span class="run-outcome ' + esc(r.outcome || "") + '">' + esc(r.outcome || "?") + "</span>" +
            esc(dur) + "</li>";
        }).join("") + "</ul>"
      : '<span class="run">no runs recorded yet</span>';
    runlogEl.innerHTML = '<span class="strip-label">recent runs</span>' + rows;
  }

  function renderSync(loop) {
    var s = loop.sync;
    if (!s) { syncEl.textContent = ""; syncEl.className = "note"; return; }
    if (s.state === "verified") {
      syncEl.textContent = s.stopped ? "pause verified on origin" : "resume verified on origin";
      syncEl.className = "note ok";
    } else if (s.state === "ambiguous") {
      syncEl.textContent = "origin state is ambiguous — " + ((s.recovery && s.recovery.command) || "/pm:loop status") + " before retrying";
      syncEl.className = "note bad";
    } else if (s.state === "blocked") {
      syncEl.textContent = "loop control blocked — " + ((s.recovery && s.recovery.command) || "run /pm:loop status");
      syncEl.className = "note bad";
    } else { syncEl.textContent = ""; syncEl.className = "note"; }
  }

  function renderGit(git) {
    if (git && git.available) {
      var when = git.observed_at ? relAge(git.observed_at) : "just now";
      var behind = git.behind == null ? "" : (git.behind > 0 ? " · " + git.behind + " behind observed origin" : " · aligned with observed origin");
      gitEl.textContent = "local refs observed " + when + behind + (git.branch ? " · " + git.branch : "") + " · /pm:sync for remote truth";
    } else if (git && git.error) {
      gitEl.textContent = "git unavailable";
    } else {
      gitEl.textContent = "";
    }
  }

  function render(data) {
    if (data.error) {
      errorEl.textContent = data.error;
      errorEl.className = "show";
      boardEl.innerHTML = "";
      budgetsEl.innerHTML = "";
      runlogEl.innerHTML = "";
      loopStateEl.style.display = "none";
      toggleBtn.disabled = true;
      return;
    }
    errorEl.className = "";
    loopStateEl.style.display = "";

    var byId = {};
    (data.cards || []).forEach(function (c) { byId[c.id] = c; });
    renderBoard(data, byId);

    var loop = data.loop || {};
    paused = !!loop.paused;
    loopStateEl.className = "pill " + (paused ? "paused" : (loop.installed ? "active" : ""));
    loopStateEl.innerHTML = '<span class="dot"></span><span>' +
      (loop.installed ? (paused ? "loop paused" : "loop active") : "loop not installed") + "</span>";
    toggleBtn.disabled = busy;
    toggleBtn.textContent = paused ? "Resume loop" : "Pause loop";

    renderStrip(loop);
    renderSync(loop);
    renderGit(data.git);
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
    var key = window.crypto && window.crypto.randomUUID
      ? window.crypto.randomUUID()
      : Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
    fetch("/api/loop/toggle", {
      method: "POST",
      headers: { "x-pm-board": "1", "content-type": "application/json" },
      body: JSON.stringify({ paused: !paused, idempotency_key: key })
    })
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
  blockerLevel,
  buildBoardPayload,
  createServer,
  displayColumnOrder,
  enrichCard,
  humanizeBlocker,
  isTrustedLocalRequest,
  parseGitHubRemote,
  prHref,
  renderPage,
  toggleLoop,
};

if (require.main === module) {
  main();
}
