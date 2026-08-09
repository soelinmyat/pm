"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const Ajv2020 = require("ajv/dist/2020");
const addFormats = require("ajv-formats");

const {
  CANDIDATE_STATES,
  applyRouting,
  createSession,
  prunePreUpgradeSnapshot,
  readSession,
  restorePreUpgradeSnapshot,
  transitionCandidate,
  validateSession,
  writeSession,
} = require("../scripts/lib/dev-session-schema");

test("new Dev sessions expose the complete v3 candidate state machine", () => {
  const repo = makeRepo();
  try {
    const session = createSession({ slug: "candidate-state", sourceDir: repo });
    assert.equal(session.schema_version, 3);
    assert.deepEqual(CANDIDATE_STATES, [
      "implementation",
      "review-candidate",
      "reviewing",
      "review-converged",
      "certifying",
      "base-check",
      "merge-ready",
      "invalidated",
    ]);
    assert.equal(session.candidate.state, "implementation");
    assert.equal(session.candidate.route, "comprehensive");
    assert.equal(session.candidate.external_effect_started_at, null);
    assert.deepEqual(validateSession(session), []);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("intake automatically records the conservative delivery classifier result", () => {
  const repo = makeRepo();
  try {
    const session = applyRouting(createSession({ slug: "candidate-route", sourceDir: repo }), {
      kind: "task",
      size: "S",
      risk: { behavioral: 1 },
      delivery_candidate: {
        changed_paths: ["apps/web/src/feature.js"],
        app_root: "apps/web",
        dependency_scope: "app-local",
        configuration_identity: `sha256:${"a".repeat(64)}`,
        risk: {
          auth: false,
          data: false,
          migration: false,
          external_contract: false,
          shared: false,
          operational: false,
          configuration: false,
          lockfile: false,
          ambiguous: false,
        },
      },
    });
    assert.equal(session.candidate.route, "review-candidate");
    assert.match(session.candidate.route_reasons[0], /confined to apps\/web/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("review-candidate authority is a draft-only ceiling", () => {
  const repo = makeRepo();
  try {
    const session = createSession({ slug: "candidate-authority", sourceDir: repo });
    session.candidate.route = "review-candidate";
    const candidate = transitionCandidate(
      session,
      { state: "review-candidate", reason: "all optimization facts are proven" },
      { now: "2026-08-09T02:00:00.000Z" }
    );
    assert.deepEqual(candidate.candidate.authority, {
      push_feature_branch: true,
      create_draft_pr: true,
      certify: false,
      ready_for_review: false,
      auto_merge: false,
      merge: false,
    });
    assert.equal(
      candidate.authority.push_feature_branch,
      false,
      "state cannot grant user authority"
    );
    assert.equal(candidate.authority.create_pr, false, "state cannot grant user authority");
    const comprehensive = createSession({ slug: "comprehensive", sourceDir: repo });
    assert.throws(
      () => transitionCandidate(comprehensive, { state: "review-candidate", reason: "try anyway" }),
      /comprehensive route cannot enter review-candidate/
    );
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("installed Dev CLI exposes candidate transitions without consumer integration", () => {
  const repo = makeRepo();
  try {
    const sessionPath = path.join(repo, ".pm", "dev-sessions", "cli-candidate", "session.json");
    const session = createSession({ slug: "cli-candidate", sourceDir: repo });
    session.candidate.route = "review-candidate";
    writeSession(sessionPath, session);
    const output = JSON.parse(
      execFileSync(
        process.execPath,
        [
          path.join(__dirname, "..", "scripts", "dev-session.js"),
          "candidate",
          "--session",
          sessionPath,
          "--state",
          "review-candidate",
          "--reason",
          "facts proven",
          "--json",
        ],
        { encoding: "utf8" }
      )
    );
    assert.equal(output.candidate.state, "review-candidate");
    assert.equal(output.candidate.external_effect_started_at, null);
    const effect = JSON.parse(
      execFileSync(
        process.execPath,
        [
          path.join(__dirname, "..", "scripts", "dev-session.js"),
          "candidate-effect",
          "--session",
          sessionPath,
          "--at",
          "2026-08-09T02:30:00.000Z",
          "--json",
        ],
        { encoding: "utf8" }
      )
    );
    assert.equal(effect.candidate.external_effect_started_at, "2026-08-09T02:30:00.000Z");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("candidate transitions are ordered, audited, and invalidation is explicit", () => {
  const repo = makeRepo();
  try {
    let session = createSession({ slug: "candidate-transitions", sourceDir: repo });
    session.candidate.route = "review-candidate";
    for (const state of [
      "review-candidate",
      "reviewing",
      "review-converged",
      "certifying",
      "base-check",
      "merge-ready",
    ]) {
      session = transitionCandidate(session, { state, reason: `advance to ${state}` });
    }
    session = transitionCandidate(session, {
      state: "invalidated",
      reason: "base moved",
    });
    assert.equal(session.candidate.state, "invalidated");
    assert.equal(session.candidate.invalidation.reason, "base moved");
    assert.equal(session.candidate.transition_history.length, 7);
    assert.throws(
      () => transitionCandidate(session, { state: "merge-ready", reason: "skip restart" }),
      /invalid candidate transition/
    );
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("v2 read upgrades atomically, preserves authority and evidence, and keeps one private snapshot", () => {
  const repo = makeRepo();
  try {
    const sessionPath = path.join(repo, ".pm", "dev-sessions", "upgrade", "session.json");
    const v2 = createSession({ slug: "upgrade", sourceDir: repo });
    v2.schema_version = 2;
    delete v2.candidate;
    v2.authority.push_feature_branch = true;
    v2.authority_log.push({
      actions: ["push_feature_branch"],
      reason: "approved before upgrade",
      granted_at: "2026-08-09T01:00:00.000Z",
    });
    v2.evidence.implementation = {
      commit: null,
      records: [{ kind: "test", command: "node --test", exit_code: 0, artifact: null }],
      recorded_at: "2026-08-09T01:01:00.000Z",
    };
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
    fs.writeFileSync(sessionPath, `${JSON.stringify(v2, null, 2)}\n`, { mode: 0o644 });

    const upgraded = readSession(sessionPath);
    assert.equal(upgraded.schema_version, 3);
    assert.deepEqual(upgraded.authority, v2.authority);
    assert.deepEqual(upgraded.evidence, v2.evidence);
    assert.equal(upgraded.candidate.external_effect_started_at, null);
    assert.equal(JSON.parse(fs.readFileSync(sessionPath, "utf8")).schema_version, 3);

    const snapshotPath = `${sessionPath}.v2.snapshot.json`;
    assert.equal(JSON.parse(fs.readFileSync(snapshotPath, "utf8")).schema_version, 2);
    assert.equal(fs.statSync(snapshotPath).mode & 0o777, 0o600);
    readSession(sessionPath);
    assert.deepEqual(
      fs.readdirSync(path.dirname(sessionPath)).filter((name) => name.includes("snapshot")),
      ["session.json.v2.snapshot.json"]
    );
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("unknown later schemas fail closed without producing a migration snapshot", () => {
  const repo = makeRepo();
  try {
    const sessionPath = path.join(repo, "session.json");
    fs.writeFileSync(sessionPath, '{"schema_version":4}\n');
    assert.throws(() => readSession(sessionPath), /unsupported Dev session schema version 4/);
    assert.equal(fs.existsSync(`${sessionPath}.v2.snapshot.json`), false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("v2 snapshot restores only before an external effect and is pruned on completion", () => {
  const repo = makeRepo();
  try {
    const sessionPath = path.join(repo, ".pm", "dev-sessions", "restore", "session.json");
    const v2 = createSession({ slug: "restore", sourceDir: repo });
    v2.schema_version = 2;
    delete v2.candidate;
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
    fs.writeFileSync(sessionPath, `${JSON.stringify(v2, null, 2)}\n`);
    const upgraded = readSession(sessionPath);

    restorePreUpgradeSnapshot(sessionPath);
    assert.equal(JSON.parse(fs.readFileSync(sessionPath, "utf8")).schema_version, 2);
    assert.equal(fs.existsSync(`${sessionPath}.v2.snapshot.json`), false);

    fs.writeFileSync(sessionPath, `${JSON.stringify(v2, null, 2)}\n`);
    const withSnapshot = readSession(sessionPath);
    withSnapshot.candidate.external_effect_started_at = "2026-08-09T02:00:00.000Z";
    writeSession(sessionPath, withSnapshot);
    assert.throws(() => restorePreUpgradeSnapshot(sessionPath), /external effect has started/);

    upgraded.status = "complete";
    writeSession(sessionPath, upgraded);
    assert.equal(prunePreUpgradeSnapshot(sessionPath, upgraded), false);
    assert.equal(fs.existsSync(`${sessionPath}.v2.snapshot.json`), false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("abandoned v2 snapshot has a bounded 30-day retention window", () => {
  const repo = makeRepo();
  try {
    const sessionPath = path.join(repo, ".pm", "dev-sessions", "abandoned", "session.json");
    const v2 = createSession({ slug: "abandoned", sourceDir: repo });
    v2.schema_version = 2;
    delete v2.candidate;
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
    fs.writeFileSync(sessionPath, `${JSON.stringify(v2, null, 2)}\n`);
    const upgraded = readSession(sessionPath);
    upgraded.status = "blocked";
    upgraded.updated_at = "2026-07-01T00:00:00.000Z";
    assert.equal(
      prunePreUpgradeSnapshot(sessionPath, upgraded, { now: "2026-07-30T23:59:59.000Z" }),
      false
    );
    assert.equal(
      prunePreUpgradeSnapshot(sessionPath, upgraded, { now: "2026-07-31T00:00:00.000Z" }),
      true
    );
    assert.equal(fs.existsSync(`${sessionPath}.v2.snapshot.json`), false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("machine-readable v3 schema agrees with the runtime candidate contract", () => {
  const repo = makeRepo();
  try {
    const schema = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, "..", "skills", "dev", "references", "dev-session.schema.json"),
        "utf8"
      )
    );
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    const session = createSession({ slug: "schema-contract", sourceDir: repo });
    assert.equal(validate(session), true, JSON.stringify(validate.errors));
    session.candidate.state = "review-candidate";
    assert.equal(validate(session), false);
    assert.ok(validate.errors.some((entry) => entry.instancePath.includes("authority")));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-candidate-state-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
  fs.writeFileSync(path.join(root, "README.md"), "fixture\n");
  execFileSync("git", ["add", "README.md"], { cwd: root });
  execFileSync("git", ["commit", "-m", "fixture"], { cwd: root, stdio: "ignore" });
  return root;
}
