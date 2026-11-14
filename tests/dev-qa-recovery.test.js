"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { fixture, digest } = require("./helpers/qa-recovery-fixture");
test("require-qa preserves predecessor evidence and authority while withdrawing downstream certification", (t) => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const next = JSON.parse(fs.readFileSync(f.sessionPath));
  assert.equal(next.run_id, f.session.run_id);
  assert.equal(next.phase, "qa");
  assert.equal(next.status, "active");
  assert.deepEqual(next.authority, f.session.authority);
  assert.deepEqual(next.authority_log, f.session.authority_log);
  assert.deepEqual(next.task, f.session.task);
  assert.deepEqual(next.attempts, f.session.attempts);
  assert.equal(next.routing.decision_version, f.session.routing.decision_version);
  assert(next.routing.required_phases.includes("qa"));
  assert(next.routing.required_gates.includes("qa"));
  assert.equal(next.evidence.review.commit, null);
  assert.deepEqual(next.evidence.review.records, []);
  assert.equal(next.evidence.qa, undefined);
  const archive = JSON.parse(
    fs.readFileSync(path.join(f.root, next.routing.qa_recovery.archive.path))
  );
  assert.equal(archive.session, f.before.toString());
  assert.equal(archive.transaction, f.beforeTransaction.toString());
  assert.equal(
    digest(fs.readFileSync(path.join(f.root, next.routing.qa_recovery.archive.path))),
    next.routing.qa_recovery.archive.sha256
  );
  assert.deepEqual(fs.readFileSync(f.transactionPath), f.beforeTransaction);
  const after = fs.readFileSync(f.sessionPath);
  const replay = f.run();
  assert.equal(replay.status, 0, replay.stderr);
  assert.equal(JSON.parse(replay.stdout).idempotent, true);
  assert.deepEqual(fs.readFileSync(f.sessionPath), after);
});

function replaceSession(f, edit) {
  const s = JSON.parse(fs.readFileSync(f.sessionPath));
  edit(s);
  fs.writeFileSync(f.sessionPath, JSON.stringify(s, null, 2) + "\n");
  f.args[f.args.indexOf("--expected-session-sha256") + 1] = digest(fs.readFileSync(f.sessionPath));
}
for (const [name, edit, message] of [
  [
    "completed session",
    (s) => {
      s.status = "complete";
    },
    /active or blocked Ship/,
  ],
  [
    "earlier phase",
    (s) => {
      s.phase = "review";
      s.status = "active";
    },
    /active or blocked Ship/,
  ],
  ["existing QA route", (s) => s.routing.required_phases.splice(3, 0, "qa"), /existing QA/],
  [
    "existing QA evidence",
    (s) => {
      s.evidence.qa = { commit: null, records: [], recorded_at: s.updated_at };
    },
    /existing QA/,
  ],
  [
    "existing QA attempt",
    (s) => s.attempts.push({ ...s.attempts[0], phase: "qa", status: "failed" }),
    /existing QA/,
  ],
  [
    "unrelated blocker",
    (s) => {
      s.blockers[0].code = "product-decision";
    },
    /unrelated blockers/,
  ],
  [
    "missing write authority",
    (s) => {
      s.authority.local_writes = false;
    },
    /local-write authority/,
  ],
  [
    "missing prior review",
    (s) => {
      delete s.evidence.review;
    },
    /completed implementation and Review/,
  ],
])
  test(`require-qa rejects ${name} without changing the session`, (t) => {
    const f = fixture(t);
    replaceSession(f, edit);
    const before = fs.readFileSync(f.sessionPath);
    const r = f.run();
    assert.equal(r.status, 3);
    assert.match(r.stderr, message);
    assert.deepEqual(fs.readFileSync(f.sessionPath), before);
  });
test("require-qa rejects stale session and HEAD identities", (t) => {
  const f = fixture(t);
  const args = [...f.args];
  args[args.indexOf("--expected-session-sha256") + 1] = `sha256:${"0".repeat(64)}`;
  assert.match(f.run(args).stderr, /session SHA-256 changed/);
  const headArgs = [...f.args];
  headArgs[headArgs.indexOf("--commit") + 1] = "0".repeat(40);
  assert.match(f.run(headArgs).stderr, /current HEAD/);
  assert.deepEqual(fs.readFileSync(f.sessionPath), f.before);
});
test("require-qa resumes an interrupted archive publication without replacing history", (t) => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
  const after = fs.readFileSync(f.sessionPath);
  const s = JSON.parse(after);
  const archivePath = path.join(f.root, s.routing.qa_recovery.archive.path);
  const archive = fs.readFileSync(archivePath);
  fs.writeFileSync(f.sessionPath, f.before); // interruption after archive, before session publication
  const r = f.run();
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(fs.readFileSync(f.sessionPath), after);
  assert.deepEqual(fs.readFileSync(archivePath), archive);
});
test("require-qa rejects tampered archives and advanced recovery replays", (t) => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
  const s = JSON.parse(fs.readFileSync(f.sessionPath));
  const archivePath = path.join(f.root, s.routing.qa_recovery.archive.path);
  const original = fs.readFileSync(archivePath);
  fs.appendFileSync(archivePath, " ");
  assert.match(f.run().stderr, /immutable archive changed/);
  fs.writeFileSync(archivePath, original);
  s.updated_at = new Date(Date.now() + 1000).toISOString();
  fs.writeFileSync(f.sessionPath, JSON.stringify(s, null, 2) + "\n");
  assert.match(f.run().stderr, /already advanced/);
});
test("require-qa rejects symlinked archive directories", (t) => {
  const f = fixture(t);
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "pm-qa-escape-"));
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  fs.symlinkSync(target, path.join(path.dirname(f.sessionPath), "recovery"));
  const r = f.run();
  assert.notEqual(r.status, 0);
  assert.deepEqual(fs.readdirSync(target), []);
  assert.deepEqual(fs.readFileSync(f.sessionPath), f.before);
});
for (const historical of [false, true])
  test(`require-qa refuses ${historical ? "historical" : "current"} delivery effects`, (t) => {
    const f = fixture(t);
    const {
      planEffect,
      advancePreparedCommit,
    } = require("../scripts/lib/release-transaction-schema");
    let tr = JSON.parse(fs.readFileSync(f.transactionPath));
    tr = planEffect(tr, {
      effect: "push",
      target: {
        remote: "origin",
        repository: "test/repo",
        branch: "fix/transport",
        commit: f.head,
      },
    });
    if (historical) {
      tr = advancePreparedCommit(tr, { commit: "1".repeat(40), reason: "fixture intermediate" });
      tr = advancePreparedCommit(tr, { commit: f.head, reason: "fixture current" });
    }
    fs.writeFileSync(f.transactionPath, JSON.stringify(tr));
    const r = f.run();
    assert.equal(r.status, 3);
    assert.match(r.stderr, /delivery effects/);
    assert.deepEqual(fs.readFileSync(f.sessionPath), f.before);
  });
test("direct release begin cannot bypass recovered QA and Review", (t) => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
  const { planEffect } = require("../scripts/lib/release-transaction-schema");
  let tr = JSON.parse(fs.readFileSync(f.transactionPath));
  tr = planEffect(tr, {
    effect: "push",
    target: { remote: "origin", repository: "test/repo", branch: "fix/transport", commit: f.head },
  });
  fs.writeFileSync(f.transactionPath, JSON.stringify(tr));
  const before = fs.readFileSync(f.transactionPath);
  const r = spawnSync(
    process.execPath,
    [
      path.resolve(__dirname, "../scripts/release-transaction.js"),
      "begin",
      "--transaction",
      f.transactionPath,
      "--session",
      f.sessionPath,
      "--effect",
      "push",
      "--actor",
      "root",
      "--json",
    ],
    { cwd: f.root, encoding: "utf8" }
  );
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /completed QA and fresh Review/);
  assert.deepEqual(fs.readFileSync(f.transactionPath), before);
});
test("recovered QA cannot use the no-UI skip exception", (t) => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
  const session = JSON.parse(fs.readFileSync(f.sessionPath));
  const { checkGateManifest } = require("../scripts/dev-gate-check");
  const result = checkGateManifest(
    {
      schema_version: 1,
      run_id: session.run_id,
      gates: [
        {
          name: "qa",
          status: "skipped",
          commit: f.head,
          artifact: null,
          reason: "no UI impact",
          checked_at: new Date().toISOString(),
        },
      ],
    },
    { canonicalSession: session, currentCommit: f.head, artifactRoot: f.root }
  );
  assert.equal(result.ok, false);
  assert(
    result.issues.some((issue) => /explicit first-QA recovery cannot skip/.test(issue.message))
  );
});

test("require-qa does not auto-upgrade a legacy session on a rejected request", (t) => {
  const f = fixture(t);
  replaceSession(f, (s) => {
    s.schema_version = 2;
  });
  const before = fs.readFileSync(f.sessionPath);
  const r = f.run();
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /schema-v3/);
  assert.deepEqual(fs.readFileSync(f.sessionPath), before);
  assert.equal(fs.existsSync(f.sessionPath + ".v2.snapshot.json"), false);
});
test("terminal relocation preserves the recovery archive bytes and digest", (t) => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
  const s = JSON.parse(fs.readFileSync(f.sessionPath));
  const active = path.dirname(f.sessionPath);
  const destination = path.join(path.dirname(active), "completed", s.slug, s.run_id);
  const before = fs.readFileSync(path.join(f.root, s.routing.qa_recovery.archive.path));
  require("../scripts/lib/dev-qa-recovery").relocateQaRecovery(s, active, destination);
  const relocated = JSON.stringify(s);
  // A crash after publishing session.json but before directory rename retries here.
  require("../scripts/lib/dev-qa-recovery").relocateQaRecovery(s, active, destination);
  assert.equal(JSON.stringify(s), relocated);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.renameSync(active, destination);
  const after = fs.readFileSync(path.join(f.root, s.routing.qa_recovery.archive.path));
  assert.deepEqual(after, before);
  assert.equal(digest(after), s.routing.qa_recovery.archive.sha256);
});
test("require-qa preserves checked Review recovery anchors", (t) => {
  const f = fixture(t);
  const anchor = {
    attempt: 1,
    round: 1,
    run_id: "prior-review",
    commit: f.head,
    outcome: "passed",
    report: {
      path: ".pm/dev-sessions/transport/review/runs/prior-review/round-1/report.json",
      sha256: "a".repeat(64),
    },
  };
  replaceSession(f, (s) => {
    s.evidence.review.recovery_history = [anchor];
  });
  const r = f.run();
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.sessionPath)).evidence.review.recovery_history, [
    anchor,
  ]);
});

test("require-qa rejects split-root sessions without mutation", (t) => {
  const f = fixture(t);
  const other = fs.mkdtempSync(path.join(os.tmpdir(), "pm-qa-other-root-"));
  t.after(() => fs.rmSync(other, { recursive: true, force: true }));
  replaceSession(f, (s) => {
    s.source.worktree = other;
  });
  const before = fs.readFileSync(f.sessionPath);
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /co-located session and worktree/);
  assert.deepEqual(fs.readFileSync(f.sessionPath), before);
});

test("published session schema accepts recovered routing and rejects misplaced recovery", (t) => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
  const session = JSON.parse(fs.readFileSync(f.sessionPath));
  const Ajv = require("ajv/dist/2020");
  const ajv = new Ajv({ strict: false });
  require("ajv-formats")(ajv);
  const validate = ajv.compile(require("../skills/dev/references/dev-session.schema.json"));
  assert.equal(validate(session), true, JSON.stringify(validate.errors));
  session.migration = {
    legacy_path: "/legacy",
    migrated_at: session.updated_at,
    qa_recovery: session.routing.qa_recovery,
  };
  assert.equal(validate(session), false);
});
