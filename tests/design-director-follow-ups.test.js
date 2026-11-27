"use strict";

// Follow-up items from Design Director reports: the collector, the session
// ledger and the two dev-session commands. Everything runs in temporary
// repositories; nothing here calls Linear or writes a backlog.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const {
  collectFollowUps,
  deliveryState,
  validateFollowUps,
} = require("../scripts/lib/design-director-follow-ups");
const { createSession, validateSession } = require("../scripts/lib/dev-session-schema");
const { approval, finding, workspace, write } = require("./helpers/design-director-fixture");

const CLI = path.resolve(__dirname, "..", "scripts", "dev-session.js");
let Ajv2020 = null;
let addFormats = null;
try {
  Ajv2020 = require("ajv/dist/2020");
  addFormats = require("ajv-formats");
} catch {
  // Optional dev dependency.
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const SYSTEM_CHANGE = "Give the shared Toolbar one button height token";

// Run "main": three reviews. f-01 is fixed, f-02 is filed in round 3, s-01 is
// a system note carried through every review and filed at the end.
function writeMainRun(root, slug = "unit") {
  const note = (status) =>
    finding("s-01", "system-note", "consistency", status, {
      location: "Shared Toolbar",
      change: SYSTEM_CHANGE,
    });
  write(
    root,
    1,
    approval({
      verdict: "reject",
      outcome: "failed",
      findings: [finding("f-01", "small", "craft"), note("open")],
    }),
    slug
  );
  write(
    root,
    2,
    approval({
      review: 2,
      round: 2,
      verdict: "reject",
      outcome: "failed",
      findings: [
        finding("f-01", "small", "craft", "fixed"),
        note("open"),
        finding("f-02", "small", "microcopy", "open", {
          first_seen_round: 2,
          location: "Orders list, empty state",
          change: "Say what creates the first order",
        }),
      ],
    }),
    slug
  );
  write(
    root,
    3,
    approval({
      review: 3,
      round: 3,
      findings: [
        finding("f-01", "small", "craft", "fixed"),
        note("filed"),
        finding("f-02", "small", "microcopy", "filed", {
          first_seen_round: 2,
          location: "Orders list, empty state",
          change: "Say what creates the first order",
        }),
      ],
    }),
    slug
  );
}

function sessionDir(root, slug = "unit") {
  return path.join(root, ".pm", "dev-sessions", slug);
}

test("the collector lists filed findings and system notes from every review of the run", () => {
  const root = workspace();
  writeMainRun(root);
  const result = collectFollowUps({ sessionDir: sessionDir(root) });
  assert.equal(result.reports.length, 3);
  assert.deepEqual(result.skipped, []);
  const byId = Object.fromEntries(result.items.map((item) => [item.sources[0].finding_id, item]));
  assert.deepEqual(Object.keys(byId).sort(), ["f-02", "s-01"]);

  const note = byId["s-01"];
  assert.equal(note.class, "system-note");
  assert.equal(note.scope, "system");
  assert.equal(note.dimension, "consistency");
  assert.equal(note.location, "Shared Toolbar");
  assert.equal(note.change, SYSTEM_CHANGE);
  assert.match(note.key, /^fu_[a-f0-9]{16}$/);
  assert.equal(
    note.report,
    path.join(sessionDir(root), "design-critique/director/main/review-3/report.json")
  );
  assert.deepEqual(note.sources, [
    {
      report: "design-critique/director/main/review-3/report.json",
      run: "main",
      review: 3,
      finding_id: "s-01",
    },
  ]);

  const small = byId["f-02"];
  assert.equal(small.class, "small");
  assert.equal(small.scope, "local");
  assert.equal(small.scope_check, null);
  assert.equal(small.first_seen_round, 2);
});

test("an open system note counts; a fixed small finding and an open one do not", () => {
  const root = workspace();
  write(
    root,
    1,
    approval({
      verdict: "reject",
      outcome: "failed",
      findings: [
        finding("f-01", "small", "craft"),
        finding("s-01", "system-note", "craft", "open", { change: SYSTEM_CHANGE }),
        finding("s-02", "system-note", "craft", "fixed", { change: "Something already done" }),
      ],
    })
  );
  const ids = collectFollowUps({ sessionDir: sessionDir(root) }).items.map(
    (item) => item.sources[0].finding_id
  );
  assert.deepEqual(ids, ["s-01"]);
});

test("the same system issue raised in two runs becomes one item with both sources", () => {
  const root = workspace();
  writeMainRun(root);
  write(
    root,
    1,
    approval({
      run_id: "second",
      findings: [
        finding("s-07", "system-note", "visual-quality", "filed", {
          location: "Settings toolbar",
          change: `  ${SYSTEM_CHANGE.toUpperCase()}. `,
        }),
      ],
    })
  );
  const items = collectFollowUps({ sessionDir: sessionDir(root) }).items;
  const notes = items.filter((item) => item.class === "system-note");
  assert.equal(notes.length, 1);
  assert.deepEqual(
    notes[0].sources.map((source) => `${source.run}/${source.finding_id}`),
    ["main/s-01", "second/s-07"]
  );
});

test("system notes written in other scripts keep distinct keys", () => {
  const root = workspace();
  write(
    root,
    1,
    approval({
      run_id: "main",
      findings: [
        finding("s-01", "system-note", "visual-quality", "filed", {
          location: "設定",
          change: "共有ボタンの角丸トークンを統一する",
        }),
        finding("s-02", "system-note", "consistency", "filed", {
          location: "Настройки",
          change: "Привести отступы карточек к общему токену",
        }),
      ],
    })
  );
  const notes = collectFollowUps({ sessionDir: sessionDir(root) }).items.filter(
    (item) => item.class === "system-note"
  );
  assert.equal(notes.length, 2);
  assert.notEqual(notes[0].key, notes[1].key);
});

test("keys are stable across collections and differ between items", () => {
  const root = workspace();
  writeMainRun(root);
  const first = collectFollowUps({ sessionDir: sessionDir(root) }).items.map((item) => item.key);
  const second = collectFollowUps({ sessionDir: sessionDir(root) }).items.map((item) => item.key);
  assert.deepEqual(first, second);
  assert.equal(new Set(first).size, first.length);
});

test("a session without director reports collects nothing", () => {
  const root = workspace();
  fs.mkdirSync(sessionDir(root), { recursive: true });
  assert.deepEqual(collectFollowUps({ sessionDir: sessionDir(root) }), {
    reports: [],
    skipped: [],
    items: [],
  });
});

test("unreadable, foreign and symlinked reports are skipped and named", () => {
  const root = workspace();
  writeMainRun(root);
  const base = path.join(sessionDir(root), "design-critique/director");
  fs.mkdirSync(path.join(base, "broken/review-1"), { recursive: true });
  fs.writeFileSync(path.join(base, "broken/review-1/report.json"), "{not json");
  fs.mkdirSync(path.join(base, "other/review-1"), { recursive: true });
  fs.writeFileSync(path.join(base, "other/review-1/report.json"), '{"schema":"other"}');
  fs.mkdirSync(path.join(base, "linked/review-1"), { recursive: true });
  fs.symlinkSync(
    path.join(base, "main/review-1/report.json"),
    path.join(base, "linked/review-1/report.json")
  );
  const result = collectFollowUps({ sessionDir: sessionDir(root) });
  assert.equal(result.reports.length, 3);
  assert.deepEqual(result.skipped.map((entry) => entry.report).sort(), [
    "design-critique/director/broken/review-1/report.json",
    "design-critique/director/linked/review-1/report.json",
    "design-critique/director/other/review-1/report.json",
  ]);
  assert.equal(result.items.length, 2);
});

test("a local leftover whose location names no declared surface is flagged for a scope check", () => {
  const root = workspace();
  writeMainRun(root);
  const inScope = collectFollowUps({
    sessionDir: sessionDir(root),
    designContext: { surfaces: [{ name: "Orders list", paths: ["web/orders/**"] }] },
  }).items.find((item) => item.class === "small");
  assert.equal(inScope.scope, "local");
  assert.equal(inScope.scope_check, null);

  const outOfScope = collectFollowUps({
    sessionDir: sessionDir(root),
    designContext: { surfaces: [{ name: "Billing settings", paths: ["web/billing/**"] }] },
  }).items.find((item) => item.class === "small");
  assert.equal(outOfScope.scope, "local");
  assert.match(outOfScope.scope_check, /names no declared surface/);
});

function deliverySession(root, { state = "MERGED", blockers = [] } = {}) {
  const dir = sessionDir(root);
  fs.mkdirSync(path.join(dir, "ship"), { recursive: true });
  const receipt = path.join(dir, "ship", "delivery.json");
  fs.writeFileSync(
    receipt,
    JSON.stringify({
      schema_version: 1,
      pr_number: 7,
      pr_url: "https://example.test/pr/7",
      state,
      merge_sha: state === "MERGED" ? "b".repeat(40) : null,
      head_branch: "feature",
      feature_commit: "a".repeat(40),
    })
  );
  return {
    blockers,
    evidence: {
      ship: {
        commit: "a".repeat(40),
        records: [{ kind: "delivery", command: "ship", exit_code: 0, artifact: receipt }],
        recorded_at: "2026-11-27T00:00:00.000Z",
      },
    },
  };
}

test("only an observed merged delivery receipt makes the items fileable", () => {
  const root = workspace();
  assert.deepEqual(deliveryState(deliverySession(root)), {
    merged: true,
    merge_sha: "b".repeat(40),
    reason: "merged",
  });
  assert.equal(deliveryState(deliverySession(root, { state: "OPEN" })).merged, false);
  assert.equal(deliveryState({ blockers: [], evidence: {} }).reason, "not merged");
  assert.equal(
    deliveryState({ blockers: [{ code: "design-director-parked" }], evidence: {} }).reason,
    "parked"
  );
});

function ledgerItem(overrides = {}) {
  return {
    key: "fu_0123456789abcdef",
    class: "system-note",
    dimension: "consistency",
    scope: "system",
    change: SYSTEM_CHANGE,
    source: "design-critique/director/main/review-3/report.json",
    state: "pending",
    tracker: null,
    ref: null,
    action: null,
    into: null,
    updated_at: "2026-11-27T00:00:00.000Z",
    ...overrides,
  };
}

function ledger(items) {
  return { schema_version: 1, merge_sha: "b".repeat(40), items };
}

const INVALID_LEDGERS = {
  "not an object": [],
  "unknown field": { ...ledger([ledgerItem()]), extra: true },
  "filed without a ref": ledger([ledgerItem({ state: "filed", tracker: "linear" })]),
  "filed with a bad linear ref": ledger([
    ledgerItem({ state: "filed", tracker: "linear", ref: "not an id", action: "created" }),
  ]),
  "pending with a ref": ledger([ledgerItem({ ref: "CLE-12" })]),
  "merged into itself": ledger([ledgerItem({ state: "merged", into: "fu_0123456789abcdef" })]),
  "merged into an unknown key": ledger([
    ledgerItem({ state: "merged", into: "fu_ffffffffffffffff" }),
  ]),
  "duplicate key": ledger([ledgerItem(), ledgerItem()]),
  "unknown state": ledger([ledgerItem({ state: "done" })]),
  "source outside the director directory": ledger([ledgerItem({ source: "../report.json" })]),
};

test("the ledger is optional and its entries follow the state rules", () => {
  const repo = makeRepo();
  let session;
  try {
    session = createSession({ slug: "unit", sourceDir: repo.root });
  } finally {
    repo.cleanup();
  }
  assert.deepEqual(validateSession(session), []);
  const valid = ledger([
    ledgerItem(),
    ledgerItem({
      key: "fu_1111111111111111",
      state: "filed",
      tracker: "linear",
      ref: "CLE-1402",
      action: "occurrence-added",
    }),
    ledgerItem({
      key: "fu_2222222222222222",
      class: "small",
      scope: "local",
      state: "filed",
      tracker: "backlog",
      ref: "backlog/toolbar-height.md",
      action: "created",
    }),
    ledgerItem({ key: "fu_3333333333333333", state: "merged", into: "fu_0123456789abcdef" }),
    ledgerItem({ key: "fu_4444444444444444", state: "declined" }),
  ]);
  const errors = [];
  validateFollowUps(valid, errors);
  assert.deepEqual(errors, []);
  assert.deepEqual(validateSession({ ...session, follow_ups: valid }), []);

  for (const [name, value] of Object.entries(INVALID_LEDGERS)) {
    const found = [];
    validateFollowUps(value, found);
    assert.ok(found.length > 0, `${name} must be rejected`);
    assert.ok(validateSession({ ...session, follow_ups: value }).length > 0, `${name} via session`);
  }

  if (Ajv2020 && addFormats) {
    const schema = readJson(
      path.resolve(__dirname, "..", "skills", "dev", "references", "dev-session.schema.json")
    );
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    assert.equal(validate(session), true, JSON.stringify(validate.errors));
    assert.equal(
      validate({ ...session, follow_ups: valid }),
      true,
      JSON.stringify(validate.errors)
    );
    for (const name of [
      "not an object",
      "unknown field",
      "filed without a ref",
      "filed with a bad linear ref",
      "pending with a ref",
      "unknown state",
      "source outside the director directory",
    ]) {
      assert.equal(validate({ ...session, follow_ups: INVALID_LEDGERS[name] }), false, name);
    }
  }
});

// CLI ---------------------------------------------------------------------

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function makeRepo() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pm-follow-ups-")));
  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test User"]);
  fs.writeFileSync(path.join(root, "README.md"), "fixture\n");
  fs.writeFileSync(path.join(root, ".gitignore"), ".pm/\n");
  git(root, ["add", "README.md", ".gitignore"]);
  git(root, ["commit", "-m", "fixture"]);
  return {
    root,
    run(args) {
      return spawnSync(process.execPath, [CLI, ...args], {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          XDG_CONFIG_HOME: path.join(root, ".test-config"),
          PM_EXECUTION_POLICY_FILE: "",
        },
      });
    },
    init(slug) {
      const result = this.run(["init", "--slug", slug, "--source-dir", root, "--json"]);
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout).session_path;
    },
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function markMerged(repo, sessionPath, options) {
  const session = readJson(sessionPath);
  const delivery = deliverySession(repo.root, options);
  session.evidence = { ...session.evidence, ...delivery.evidence };
  session.blockers = [...session.blockers, ...delivery.blockers];
  fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2));
}

function followUps(repo, sessionPath) {
  const result = repo.run(["follow-ups", "--session", sessionPath, "--json"]);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function record(repo, sessionPath, args) {
  return repo.run(["follow-up-record", "--session", sessionPath, ...args, "--json"]);
}

test("follow-ups leaves a session without director reports untouched", () => {
  const repo = makeRepo();
  try {
    const sessionPath = repo.init("unit");
    markMerged(repo, sessionPath);
    const before = fs.readFileSync(sessionPath);
    const output = followUps(repo, sessionPath);
    assert.deepEqual(output.items, []);
    assert.deepEqual(output.reports, []);
    assert.equal(output.fileable, false);
    assert.equal(output.reason, "no director reports");
    assert.deepEqual(fs.readFileSync(sessionPath), before);
    assert.equal(readJson(sessionPath).follow_ups, undefined);
  } finally {
    repo.cleanup();
  }
});

test("before a merge the items are listed, held in the report and cannot be recorded", () => {
  const repo = makeRepo();
  try {
    const sessionPath = repo.init("unit");
    writeMainRun(repo.root);
    markMerged(repo, sessionPath, { state: "OPEN" });
    const before = fs.readFileSync(sessionPath);
    const output = followUps(repo, sessionPath);
    assert.equal(output.fileable, false);
    assert.equal(output.reason, "not merged");
    assert.equal(output.items.length, 2);
    assert.ok(output.items.every((item) => item.state === "held"));
    assert.deepEqual(fs.readFileSync(sessionPath), before);

    const refused = record(repo, sessionPath, [
      "--key",
      output.items[0].key,
      "--state",
      "declined",
    ]);
    assert.equal(refused.status, 3, refused.stderr);
    assert.match(refused.stderr, /not merged/);
  } finally {
    repo.cleanup();
  }
});

test("after a merge items are recorded as pending, filed once, and survive completion", () => {
  const repo = makeRepo();
  try {
    const sessionPath = repo.init("unit");
    writeMainRun(repo.root);
    markMerged(repo, sessionPath);

    const first = followUps(repo, sessionPath);
    assert.equal(first.fileable, true);
    assert.equal(first.merge_sha, "b".repeat(40));
    assert.deepEqual(
      first.items.map((item) => item.state),
      ["pending", "pending"]
    );
    const stored = readJson(sessionPath).follow_ups;
    assert.equal(stored.items.length, 2);
    assert.deepEqual(validateSession(readJson(sessionPath)), []);

    const unchanged = fs.readFileSync(sessionPath);
    followUps(repo, sessionPath);
    assert.deepEqual(fs.readFileSync(sessionPath), unchanged, "a rerun writes nothing new");

    const [note, small] = [
      first.items.find((item) => item.class === "system-note"),
      first.items.find((item) => item.class === "small"),
    ];
    const filed = record(repo, sessionPath, [
      "--key",
      note.key,
      "--state",
      "filed",
      "--tracker",
      "linear",
      "--ref",
      "CLE-1402",
      "--action",
      "occurrence-added",
    ]);
    assert.equal(filed.status, 0, filed.stderr);
    assert.equal(JSON.parse(filed.stdout).item.state, "filed");

    const again = record(repo, sessionPath, [
      "--key",
      note.key,
      "--state",
      "filed",
      "--tracker",
      "linear",
      "--ref",
      "CLE-1402",
      "--action",
      "occurrence-added",
    ]);
    assert.equal(again.status, 0, again.stderr);
    assert.equal(JSON.parse(again.stdout).idempotent, true);

    const twice = record(repo, sessionPath, [
      "--key",
      note.key,
      "--state",
      "filed",
      "--tracker",
      "linear",
      "--ref",
      "CLE-1500",
      "--action",
      "created",
    ]);
    assert.equal(twice.status, 3);
    assert.match(twice.stderr, /already filed as CLE-1402/);

    const missing = record(repo, sessionPath, ["--key", small.key, "--state", "filed"]);
    assert.equal(missing.status, 2);

    const unknown = record(repo, sessionPath, [
      "--key",
      "fu_ffffffffffffffff",
      "--state",
      "declined",
    ]);
    assert.equal(unknown.status, 3);

    const rescoped = record(repo, sessionPath, [
      "--key",
      small.key,
      "--state",
      "pending",
      "--scope",
      "system",
    ]);
    assert.equal(rescoped.status, 0, rescoped.stderr);

    const listed = followUps(repo, sessionPath);
    const byKey = Object.fromEntries(listed.items.map((item) => [item.key, item]));
    assert.equal(byKey[note.key].state, "filed");
    assert.equal(byKey[note.key].ref, "CLE-1402");
    assert.equal(byKey[small.key].state, "pending");
    assert.equal(byKey[small.key].scope, "system");
    assert.deepEqual(listed.counts, { pending: 1, filed: 1, merged: 0, declined: 0 });

    // Complete the run: the session moves to its archive and the active path
    // keeps only completion.json. The pending item is still visible there.
    const session = readJson(sessionPath);
    session.phase = "retro";
    session.routing.required_phases = ["retro"];
    session.routing.required_gates = [];
    fs.writeFileSync(sessionPath, JSON.stringify(session));
    const resultPath = path.join(repo.root, "retro.json");
    fs.writeFileSync(
      resultPath,
      JSON.stringify({
        schema_version: 1,
        run_id: session.run_id,
        phase: "retro",
        attempt: 1,
        status: "passed",
        summary: "Retro complete",
        commit: null,
        files_changed: [],
        evidence: [{ kind: "retro", command: "retro", exit_code: 0, artifact: null }],
        blocker: null,
        runtime: { provider: "inline", model: "test", reasoning: "high" },
      })
    );
    const completed = repo.run(["record", "--session", sessionPath, "--result", resultPath]);
    assert.equal(completed.status, 0, completed.stderr);
    assert.equal(fs.existsSync(sessionPath), false);

    const archived = followUps(repo, sessionPath);
    assert.notEqual(archived.session_path, sessionPath);
    assert.equal(archived.items.find((item) => item.key === small.key).state, "pending");
    const late = record(repo, sessionPath, ["--key", small.key, "--state", "declined"]);
    assert.equal(late.status, 0, late.stderr);
    assert.equal(
      followUps(repo, sessionPath).items.find((item) => item.key === small.key).state,
      "declined"
    );
  } finally {
    repo.cleanup();
  }
});

test("a parked run is never fileable", () => {
  const repo = makeRepo();
  try {
    const sessionPath = repo.init("unit");
    writeMainRun(repo.root);
    const session = readJson(sessionPath);
    session.status = "blocked";
    session.blockers = [
      {
        code: "design-director-parked",
        reason: "Parked at the round 3 rejection",
        phase: "design-critique",
        recorded_at: "2026-11-27T00:00:00.000Z",
      },
    ];
    fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2));
    const before = fs.readFileSync(sessionPath);
    const output = followUps(repo, sessionPath);
    assert.equal(output.fileable, false);
    assert.equal(output.reason, "parked");
    assert.equal(output.items.length, 2);
    assert.deepEqual(fs.readFileSync(sessionPath), before);
  } finally {
    repo.cleanup();
  }
});

test("follow-ups read director reports by the report checker's own path rules", () => {
  // One definition of a run name, a review folder and the review limit.
  const report = require("../scripts/lib/design-director-report");
  assert.equal(typeof report.DIRECTOR_RUN_RE?.test, "function");
  assert.equal(typeof report.DIRECTOR_REVIEW_RE?.exec, "function");
  assert.equal(typeof report.SESSION_REPORT_RE?.test, "function");
  assert.ok(report.SESSION_REPORT_RE.test("design-critique/director/run-1/review-5/report.json"));
  assert.ok(!report.SESSION_REPORT_RE.test("design-critique/director/run-1/review-6/report.json"));
  assert.equal(report.DIRECTOR_REVIEW_RE.exec(`review-${report.MAX_REVIEWS}`)[1], "5");
  const source = fs.readFileSync(
    path.join(__dirname, "../scripts/lib/design-director-follow-ups.js"),
    "utf8"
  );
  assert.doesNotMatch(source, /review-\[1-5\]|\{0,63\}/, "no second copy of the path rules");
});
