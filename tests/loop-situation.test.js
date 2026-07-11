"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { assessSituation } = require("../scripts/loop-situation.js");

function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-loop-sit-"));
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

// Same-repo layout: <project>/pm + <project>/.pm
function initProject(dir, { config = null, stop = false, cards = [], leases = [] } = {}) {
  fs.mkdirSync(path.join(dir, "pm", "backlog"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".pm"), { recursive: true });
  if (config) {
    fs.mkdirSync(path.join(dir, "pm", "loop"), { recursive: true });
    fs.writeFileSync(path.join(dir, "pm", "loop", "config.json"), JSON.stringify(config));
  }
  if (stop) {
    fs.mkdirSync(path.join(dir, "pm", "loop"), { recursive: true });
    fs.writeFileSync(path.join(dir, "pm", "loop", "STOP"), "halt\n");
  }
  for (const c of cards) {
    const fm = Object.entries(c)
      .filter(([k]) => k !== "slug" && k !== "body")
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? JSON.stringify(v) : v}`)
      .join("\n");
    fs.writeFileSync(
      path.join(dir, "pm", "backlog", `${c.slug}.md`),
      `---\n${fm}\n---\n${c.body || ""}\n`
    );
  }
  if (leases.length) {
    fs.mkdirSync(path.join(dir, "pm", "loop", "leases"), { recursive: true });
    for (const l of leases) {
      const expires = new Date(Date.now() + 30 * 60000).toISOString();
      fs.writeFileSync(
        path.join(dir, "pm", "loop", "leases", `${l.card_id}-${l.stage}.json`),
        JSON.stringify({ ...l, expires_at: expires, claimed_at: new Date().toISOString() })
      );
    }
  }
}

// A loop-ready card: proposal that has BOTH an RFC and implementation approval
// (the real precondition for ready_for_dev).
const approved = (slug, extra = {}) => ({
  slug,
  id: slug.toUpperCase(),
  title: `Card ${slug}`,
  kind: "proposal",
  status: "ready_for_dev",
  rfc: `rfcs/${slug}.html`,
  implementation_approved: true,
  approved_by: "op",
  approved_at: "2026-07-01",
  ...extra,
});

test("unconfigured: no loop config → state unconfigured", () => {
  const { dir, cleanup } = tmp();
  try {
    initProject(dir, { config: null });
    const s = assessSituation(dir);
    assert.equal(s.state, "unconfigured");
    assert.equal(s.configured, false);
  } finally {
    cleanup();
  }
});

test("no-work: configured, no dispatchable cards → no-work", () => {
  const { dir, cleanup } = tmp();
  try {
    initProject(dir, { config: { autonomy: {} }, cards: [] });
    const s = assessSituation(dir);
    assert.equal(s.state, "no-work");
    assert.equal(s.configured, true);
    assert.equal(s.installed, false);
  } finally {
    cleanup();
  }
});

test("ready-not-run: approved cards, not installed → ready-not-run with the list", () => {
  const { dir, cleanup } = tmp();
  try {
    initProject(dir, { config: { autonomy: {} }, cards: [approved("alpha"), approved("beta")] });
    let releaseChecks = 0;
    const s = assessSituation(dir, {
      releaseGateProbe() {
        releaseChecks += 1;
        return { passed: true, reason: "" };
      },
    });
    assert.equal(s.state, "ready-not-run");
    assert.equal(s.board.ready.length, 2);
    assert.deepEqual(s.board.ready.map((c) => c.id).sort(), ["ALPHA", "BETA"]);
    assert.equal(releaseChecks, 0);
  } finally {
    cleanup();
  }
});

test("paused: STOP file wins over everything", () => {
  const { dir, cleanup } = tmp();
  try {
    initProject(dir, { config: { autonomy: {} }, stop: true, cards: [approved("alpha")] });
    const s = assessSituation(dir);
    assert.equal(s.state, "paused");
    assert.equal(s.paused, true);
  } finally {
    cleanup();
  }
});

test("in-progress: an active lease wins over ready-not-run", () => {
  const { dir, cleanup } = tmp();
  try {
    initProject(dir, {
      config: { autonomy: {} },
      cards: [approved("alpha", { status: "implementing" })],
      leases: [{ card_id: "ALPHA", stage: "dev", holder: "mac-1", runtime: "claude" }],
    });
    let releaseChecks = 0;
    const s = assessSituation(dir, {
      installedProbe: () => true,
      releaseGateProbe() {
        releaseChecks += 1;
        return { passed: false, reason: "should not run" };
      },
    });
    assert.equal(s.state, "in-progress");
    assert.equal(s.board.activeLeases.length, 1);
    assert.equal(s.board.activeLeases[0].holder, "mac-1");
    assert.equal(releaseChecks, 0);
  } finally {
    cleanup();
  }
});

test("fail-soft: a non-pm directory returns unconfigured, never throws", () => {
  const { dir, cleanup } = tmp();
  try {
    const s = assessSituation(dir);
    assert.equal(s.state, "unconfigured");
    assert.ok(s.note);
  } finally {
    cleanup();
  }
});

test("CLI: --json emits a parseable situation object; bare emits the state word", () => {
  const { spawnSync } = require("node:child_process");
  const script = path.join(__dirname, "..", "scripts", "loop-situation.js");
  const { dir, cleanup } = tmp();
  try {
    initProject(dir, { config: { autonomy: {} }, cards: [approved("alpha")] });
    const j = spawnSync(process.execPath, [script, "--project-dir", dir, "--json"], {
      encoding: "utf8",
    });
    assert.equal(j.status, 0, j.stderr);
    const parsed = JSON.parse(j.stdout);
    assert.equal(parsed.state, "ready-not-run");
    const bare = spawnSync(process.execPath, [script, "--project-dir", dir], { encoding: "utf8" });
    assert.equal(bare.status, 0, bare.stderr);
    assert.equal(bare.stdout.trim(), "ready-not-run");
  } finally {
    cleanup();
  }
});

test("malformed config: invalid JSON → unconfigured, configured:true, note", () => {
  const { dir, cleanup } = tmp();
  try {
    initProject(dir, { config: { autonomy: {} } });
    fs.writeFileSync(path.join(dir, "pm", "loop", "config.json"), "{ not json");
    const s = assessSituation(dir);
    assert.equal(s.state, "unconfigured");
    assert.equal(s.configured, true);
    assert.match(s.note, /unreadable/);
  } finally {
    cleanup();
  }
});

test("wrong-type config (array) is rejected, not coerced to permissive defaults", () => {
  const { dir, cleanup } = tmp();
  try {
    initProject(dir, { config: { autonomy: {} } });
    fs.writeFileSync(path.join(dir, "pm", "loop", "config.json"), "[]");
    const s = assessSituation(dir);
    assert.equal(s.state, "unconfigured");
    assert.equal(s.configured, true);
    assert.match(s.note, /unreadable|object/i);
  } finally {
    cleanup();
  }
});

test("installed-idle: injected installed probe true + ready cards → installed-idle", () => {
  const { dir, cleanup } = tmp();
  try {
    initProject(dir, { config: { autonomy: {} }, cards: [approved("alpha")] });
    const s = assessSituation(dir, {
      installedProbe: () => true,
      releaseGateProbe: () => ({ passed: true, reason: "" }),
    });
    assert.equal(s.state, "installed-idle");
    assert.equal(s.installed, true);
  } finally {
    cleanup();
  }
});

test("installed scheduler with failed evidence routes to canary-required", () => {
  const { dir, cleanup } = tmp();
  try {
    initProject(dir, { config: { autonomy: {} }, cards: [approved("alpha")] });
    const s = assessSituation(dir, {
      installedProbe: () => true,
      releaseGateProbe: () => ({ passed: false, reason: "mixed canary evidence identity" }),
    });
    assert.equal(s.state, "canary-required");
    assert.match(s.note, /mixed canary evidence identity/i);
  } finally {
    cleanup();
  }
});

test("engine reflects default_runtime when worker.engine is unset", () => {
  const { dir, cleanup } = tmp();
  try {
    initProject(dir, {
      config: { autonomy: {}, default_runtime: "codex", worker: {} },
      cards: [approved("a")],
    });
    const s = assessSituation(dir);
    assert.equal(s.config.engine, "codex");
  } finally {
    cleanup();
  }
});

test("configuration summary exposes bounded daily runtime and safety warnings", () => {
  const { dir, cleanup } = tmp();
  try {
    initProject(dir, {
      config: {
        autonomy: { merge_pr: true },
        worker: { codex_sandbox: "danger-full-access" },
      },
    });
    const s = assessSituation(dir);
    assert.equal(s.config.maximum_daily_claim_envelope_seconds, 158760);
    assert.equal(s.config.lease_ttl_seconds, 7200);
    assert.equal(s.config.ttl_margin_seconds, 90);
    assert.ok(s.config.warnings.some((warning) => /merge autonomy/i.test(warning)));
    assert.ok(s.config.warnings.some((warning) => /danger-full-access/i.test(warning)));
    assert.equal(s.releaseGate.applicable, false);
  } finally {
    cleanup();
  }
});

test("in-progress lease surfaces cardExists=false for an orphaned lease", () => {
  const { dir, cleanup } = tmp();
  try {
    initProject(dir, {
      config: { autonomy: {} },
      leases: [{ card_id: "ZOMBIE", stage: "dev", holder: "m", runtime: "claude" }],
    });
    const s = assessSituation(dir);
    assert.equal(s.state, "in-progress");
    assert.equal(s.board.activeLeases[0].cardExists, false);
  } finally {
    cleanup();
  }
});

test("separate-repo: pm.config.json pointing at a sibling KB resolves correctly", () => {
  const { dir, cleanup } = tmp();
  try {
    // code repo <dir> with .pm/config.json → pm lives in ../kb/pm
    const kb = path.join(dir, "kb");
    fs.mkdirSync(path.join(kb, "pm", "backlog"), { recursive: true });
    fs.mkdirSync(path.join(kb, "pm", "loop"), { recursive: true });
    fs.writeFileSync(path.join(kb, "pm", "loop", "config.json"), JSON.stringify({ autonomy: {} }));
    fs.mkdirSync(path.join(dir, ".pm"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, ".pm", "config.json"),
      JSON.stringify({ pm_repo: { type: "local", path: "../kb" } })
    );
    const c = approved("beta");
    const fm = Object.entries(c)
      .filter(([k]) => k !== "slug")
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");
    fs.writeFileSync(path.join(kb, "pm", "backlog", "beta.md"), `---\n${fm}\n---\n`);
    const s = assessSituation(dir);
    assert.ok(["ready-not-run", "no-work"].includes(s.state), `resolved state=${s.state}`);
    assert.equal(s.configured, true);
  } finally {
    cleanup();
  }
});
