"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { executionConfigHash, normalizeLoopConfig, sha256 } = require("../scripts/loop-config.js");
const { claimLease } = require("../scripts/loop-git.js");
const {
  checkpointRecovery,
  createRunId,
  finalizeRun,
  inspectRemoteRunState,
  markRunDispatched,
  runIsolatedTransaction,
} = require("../scripts/loop-pm-transaction.js");

const FIXED_NOW = new Date("2026-07-10T00:00:00.000Z");
const GIT_ENV_KEYS_TO_CLEAR = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_PREFIX",
  "GIT_NAMESPACE",
  "GIT_SUPER_PREFIX",
];

function cleanGitEnv() {
  const env = { ...process.env };
  for (const key of GIT_ENV_KEYS_TO_CLEAR) delete env[key];
  return env;
}

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    env: cleanGitEnv(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function bareGit(remote, args) {
  return git(process.cwd(), ["--git-dir", remote, ...args]);
}

function cardBody(note = "body") {
  return [
    "---",
    "type: backlog",
    "id: PM-TX1",
    "title: Transaction fixture",
    "kind: task",
    "status: planned",
    "implementation_approved: true",
    "approved_by: test",
    "approved_at: 2026-07-10",
    "updated: 2026-07-10",
    "---",
    "",
    note,
    "",
  ].join("\n");
}

function makeFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-loop-transaction-"));
  const remote = path.join(root, "origin.git");
  const project = path.join(root, "project");
  const pmDir = path.join(project, "pm");
  const cardPath = path.join(pmDir, "backlog", "transaction.md");
  fs.mkdirSync(project, { recursive: true });
  git(project, ["init"]);
  git(project, ["config", "user.name", "PM Transaction Test"]);
  git(project, ["config", "user.email", "pm-transaction@example.com"]);
  fs.mkdirSync(path.dirname(cardPath), { recursive: true });
  fs.writeFileSync(cardPath, cardBody());
  git(project, ["add", "pm/backlog/transaction.md"]);
  git(project, ["commit", "-m", "fixture"]);
  git(root, ["init", "--bare", remote]);
  git(project, ["branch", "-M", "main"]);
  git(project, ["remote", "add", "origin", remote]);
  git(project, ["push", "-u", "origin", "main"]);
  bareGit(remote, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, remote, project, pmDir, cardPath };
}

function remoteFile(fixture, relativePath) {
  return bareGit(fixture.remote, ["show", `main:${relativePath}`]);
}

function remoteExists(fixture, relativePath) {
  try {
    bareGit(fixture.remote, ["cat-file", "-e", `main:${relativePath}`]);
    return true;
  } catch {
    return false;
  }
}

function remoteCommit(fixture, mutate, message = "remote race") {
  const clone = path.join(fixture.root, `race-${Math.random().toString(16).slice(2)}`);
  git(fixture.root, ["clone", fixture.remote, clone]);
  git(clone, ["config", "user.name", "PM Race"]);
  git(clone, ["config", "user.email", "pm-race@example.com"]);
  mutate(clone);
  git(clone, ["add", "-A"]);
  git(clone, ["commit", "-m", message]);
  git(clone, ["push"]);
}

function claim(fixture, options = {}) {
  const config = normalizeLoopConfig({ autonomy: { start_dev: true } });
  const runId = options.runId || createRunId();
  const expectedCardRevision = sha256(fs.readFileSync(fixture.cardPath));
  const expectedHeadOid = git(fixture.project, ["rev-parse", "HEAD"]);
  const result = claimLease(
    fixture.pmDir,
    {
      cardId: "PM-TX1",
      stage: "dev",
      holder: "machine-a",
      sourcePath: fixture.cardPath,
      runId,
      configFingerprint: executionConfigHash(config),
      attempt: 1,
    },
    config,
    {
      expectedHeadOid,
      expectedCardRevision,
      now: FIXED_NOW,
      ...options,
    }
  );
  return { config, runId, expectedCardRevision, expectedHeadOid, result };
}

test("claim uses an isolated detached transaction and atomically writes lease plus attempt event", (t) => {
  const fixture = makeFixture(t);
  const sharedHead = git(fixture.project, ["rev-parse", "HEAD"]);
  const sharedStatus = git(fixture.project, ["status", "--porcelain"]);
  const firstId = createRunId();
  const secondId = createRunId();
  assert.match(firstId, /^loop-[0-9a-f]{8}-[0-9a-f-]{27}$/);
  assert.notEqual(firstId, secondId);

  const claimed = claim(fixture, { runId: firstId });

  assert.equal(claimed.result.ok, true);
  assert.equal(claimed.result.pushed, true);
  assert.equal(claimed.result.lease.run_id, firstId);
  assert.equal(claimed.result.lease.phase, "claimed");
  assert.equal(claimed.result.lease.expected_card_revision, claimed.expectedCardRevision);
  assert.equal(claimed.result.lease.config_fingerprint, executionConfigHash(claimed.config));
  assert.equal(claimed.result.lease.upstream_oid, sharedHead);
  assert.equal(git(fixture.project, ["rev-parse", "HEAD"]), sharedHead);
  assert.equal(git(fixture.project, ["status", "--porcelain"]), sharedStatus);

  const lease = JSON.parse(remoteFile(fixture, "pm/loop/leases/dev-pm-tx1.json"));
  const event = JSON.parse(remoteFile(fixture, `pm/loop/events/${firstId}.json`));
  assert.equal(lease.run_id, firstId);
  assert.equal(event.run_id, firstId);
  assert.equal(event.status, "claimed");
  assert.equal(event.attempt, 1);
  assert.equal(event.terminal, false);
  assert.deepEqual(
    bareGit(fixture.remote, ["diff-tree", "--no-commit-id", "--name-only", "-r", "main"])
      .split("\n")
      .sort(),
    [`pm/loop/events/${firstId}.json`, "pm/loop/leases/dev-pm-tx1.json"].sort()
  );
});

test("checkpoint and finalization atomically persist recovery then card/event/artifact cleanup", (t) => {
  const fixture = makeFixture(t);
  const sharedHead = git(fixture.project, ["rev-parse", "HEAD"]);
  const claimed = claim(fixture);
  assert.equal(claimed.result.ok, true);

  const dispatched = markRunDispatched(fixture.pmDir, {
    runId: claimed.runId,
    cardId: "PM-TX1",
    stage: "dev",
    dispatchedAt: "2026-07-10T00:00:05.000Z",
  });
  assert.equal(dispatched.ok, true, JSON.stringify(dispatched));

  const updatedCard = cardBody("finalized card").replace("status: planned", "status: needs-human");
  const transition = {
    card_write: {
      relative_path: "pm/backlog/transaction.md",
      expected_revision: claimed.expectedCardRevision,
      content: updatedCard,
    },
    artifact_writes: [
      {
        relative_path: "pm/evidence/transaction-result.md",
        content: "durable artifact\n",
      },
    ],
  };
  const checkpoint = checkpointRecovery(fixture.pmDir, {
    runId: claimed.runId,
    cardId: "PM-TX1",
    stage: "dev",
    resultHash: sha256("validated-result"),
    artifactHashes: [sha256("durable artifact\n")],
    transition,
    checkpointedAt: "2026-07-10T00:00:10.000Z",
  });
  assert.equal(checkpoint.ok, true);
  const recovery = JSON.parse(remoteFile(fixture, `pm/loop/recovery/${claimed.runId}.json`));
  const finalizingLease = JSON.parse(remoteFile(fixture, "pm/loop/leases/dev-pm-tx1.json"));
  assert.equal(recovery.result_hash, sha256("validated-result"));
  assert.deepEqual(recovery.transition, transition);
  assert.equal(finalizingLease.phase, "finalizing");
  assert.equal(finalizingLease.result_hash, recovery.result_hash);

  const finalized = finalizeRun(fixture.pmDir, {
    runId: claimed.runId,
    cardId: "PM-TX1",
    stage: "dev",
    event: {
      status: "blocked",
      summary: "requires operator action",
      terminal: true,
      attempts: 1,
    },
    allowedArtifactPaths: ["pm/evidence/transaction-result.md"],
    finalizedAt: "2026-07-10T00:00:15.000Z",
  });
  assert.equal(finalized.ok, true);
  assert.equal(remoteFile(fixture, "pm/backlog/transaction.md"), updatedCard.trim());
  assert.equal(remoteFile(fixture, "pm/evidence/transaction-result.md"), "durable artifact");
  assert.equal(remoteExists(fixture, "pm/loop/leases/dev-pm-tx1.json"), false);
  assert.equal(remoteExists(fixture, `pm/loop/recovery/${claimed.runId}.json`), false);
  const terminalEvent = JSON.parse(remoteFile(fixture, `pm/loop/events/${claimed.runId}.json`));
  assert.equal(terminalEvent.status, "blocked");
  assert.equal(terminalEvent.terminal, true);
  assert.equal(git(fixture.project, ["rev-parse", "HEAD"]), sharedHead);
  assert.equal(git(fixture.project, ["status", "--porcelain"]), "");
});

test("recovery inspection distinguishes never-dispatched, dispatched, finalized, and ambiguous runs", (t) => {
  const fixture = makeFixture(t);
  const claimed = claim(fixture);
  assert.equal(claimed.result.ok, true);

  let state = inspectRemoteRunState(fixture.pmDir, claimed.runId, { now: FIXED_NOW });
  assert.equal(state.state, "never-dispatched");
  assert.equal(state.redispatch, false, "an unexpired claim may still be about to dispatch");

  const dispatched = markRunDispatched(fixture.pmDir, {
    runId: claimed.runId,
    cardId: "PM-TX1",
    stage: "dev",
    dispatchedAt: "2026-07-10T00:00:05.000Z",
  });
  assert.equal(dispatched.ok, true, JSON.stringify(dispatched));
  state = inspectRemoteRunState(fixture.pmDir, claimed.runId, { now: FIXED_NOW });
  assert.equal(state.state, "dispatched-without-terminal-result");
  assert.equal(state.redispatch, false);

  remoteCommit(fixture, (clone) => {
    const recoveryPath = path.join(clone, "pm", "loop", "recovery", `${claimed.runId}.json`);
    fs.mkdirSync(path.dirname(recoveryPath), { recursive: true });
    fs.writeFileSync(recoveryPath, '{"run_id":"different-run"}\n');
  });
  state = inspectRemoteRunState(fixture.pmDir, claimed.runId, { now: FIXED_NOW });
  assert.equal(state.state, "ambiguous");
  assert.equal(state.redispatch, false);
});

test("expired recovery stays recovery-only and finalization clears stale local journal state", (t) => {
  const fixture = makeFixture(t);
  const claimed = claim(fixture);
  const transition = {
    card_write: {
      relative_path: "pm/backlog/transaction.md",
      expected_revision: claimed.expectedCardRevision,
      content: cardBody("recovered").replace("status: planned", "status: needs-human"),
    },
    artifact_writes: [],
  };
  const dispatched = markRunDispatched(fixture.pmDir, {
    runId: claimed.runId,
    cardId: "PM-TX1",
    stage: "dev",
  });
  assert.equal(dispatched.ok, true, JSON.stringify(dispatched));
  assert.equal(
    checkpointRecovery(fixture.pmDir, {
      runId: claimed.runId,
      cardId: "PM-TX1",
      stage: "dev",
      resultHash: sha256("result"),
      artifactHashes: [],
      transition,
    }).ok,
    true
  );

  let state = inspectRemoteRunState(fixture.pmDir, claimed.runId, {
    now: new Date("2026-07-11T00:00:00.000Z"),
  });
  assert.equal(state.state, "recovery-ready");
  assert.equal(state.lease_expired, true);
  assert.equal(state.redispatch, false);

  assert.equal(
    finalizeRun(fixture.pmDir, {
      runId: claimed.runId,
      cardId: "PM-TX1",
      stage: "dev",
      event: { status: "blocked", terminal: true, summary: "recovered" },
      allowedArtifactPaths: [],
    }).ok,
    true
  );
  const journal = path.join(fixture.root, "local-journal.json");
  fs.writeFileSync(journal, "stale\n");
  state = inspectRemoteRunState(fixture.pmDir, claimed.runId, {
    now: new Date("2026-07-11T00:00:00.000Z"),
    localJournalPath: journal,
  });
  assert.equal(state.state, "finalized");
  assert.equal(fs.existsSync(journal), false);
});

test("CAS retries rebuild from a new upstream tip but card conflicts fail closed", (t) => {
  const fixture = makeFixture(t);
  const claimed = claim(fixture);
  const transition = {
    card_write: {
      relative_path: "pm/backlog/transaction.md",
      expected_revision: claimed.expectedCardRevision,
      content: cardBody("finalized").replace("status: planned", "status: needs-human"),
    },
    artifact_writes: [],
  };
  const dispatched = markRunDispatched(fixture.pmDir, {
    runId: claimed.runId,
    cardId: "PM-TX1",
    stage: "dev",
  });
  assert.equal(dispatched.ok, true, JSON.stringify(dispatched));
  assert.equal(
    checkpointRecovery(fixture.pmDir, {
      runId: claimed.runId,
      cardId: "PM-TX1",
      stage: "dev",
      resultHash: sha256("result"),
      artifactHashes: [],
      transition,
    }).ok,
    true
  );

  let raced = false;
  const finalized = finalizeRun(fixture.pmDir, {
    runId: claimed.runId,
    cardId: "PM-TX1",
    stage: "dev",
    event: { status: "blocked", terminal: true, summary: "race-safe" },
    allowedArtifactPaths: [],
    beforePush({ attempt }) {
      if (attempt !== 1 || raced) return;
      raced = true;
      remoteCommit(fixture, (clone) => {
        const note = path.join(clone, "pm", "loop", "unrelated.txt");
        fs.mkdirSync(path.dirname(note), { recursive: true });
        fs.writeFileSync(note, "concurrent update\n");
      });
    },
  });
  assert.equal(finalized.ok, true);
  assert.equal(finalized.attempts, 2);
  assert.equal(remoteFile(fixture, "pm/loop/unrelated.txt"), "concurrent update");

  const second = makeFixture(t);
  const secondClaim = claim(second);
  assert.equal(
    markRunDispatched(second.pmDir, {
      runId: secondClaim.runId,
      cardId: "PM-TX1",
      stage: "dev",
    }).ok,
    true
  );
  assert.equal(
    checkpointRecovery(second.pmDir, {
      runId: secondClaim.runId,
      cardId: "PM-TX1",
      stage: "dev",
      resultHash: sha256("result"),
      artifactHashes: [],
      transition: {
        card_write: {
          relative_path: "pm/backlog/transaction.md",
          expected_revision: secondClaim.expectedCardRevision,
          content: cardBody("ours").replace("status: planned", "status: needs-human"),
        },
        artifact_writes: [],
      },
    }).ok,
    true
  );
  let cardRaced = false;
  const blocked = finalizeRun(second.pmDir, {
    runId: secondClaim.runId,
    cardId: "PM-TX1",
    stage: "dev",
    event: { status: "blocked", terminal: true, summary: "must not overwrite" },
    allowedArtifactPaths: [],
    beforePush({ attempt }) {
      if (attempt !== 1 || cardRaced) return;
      cardRaced = true;
      remoteCommit(
        second,
        (clone) => {
          fs.writeFileSync(
            path.join(clone, "pm", "backlog", "transaction.md"),
            cardBody("operator edit")
          );
        },
        "operator card edit"
      );
    },
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, "card-revision-conflict");
  assert.equal(remoteFile(second, "pm/backlog/transaction.md"), cardBody("operator edit").trim());
  assert.equal(remoteExists(second, "pm/loop/leases/dev-pm-tx1.json"), true);
  assert.equal(remoteExists(second, `pm/loop/recovery/${secondClaim.runId}.json`), true);
});

test("cleanup failure preserves the authoritative remote claim without dirtying the shared checkout", (t) => {
  const fixture = makeFixture(t);
  const sharedHead = git(fixture.project, ["rev-parse", "HEAD"]);
  const claimed = claim(fixture, {
    removeWorktree() {
      throw new Error("injected cleanup failure");
    },
  });

  assert.equal(claimed.result.ok, true);
  assert.equal(claimed.result.cleanup_ok, false);
  assert.match(claimed.result.cleanup_error, /injected cleanup failure/);
  assert.equal(remoteExists(fixture, "pm/loop/leases/dev-pm-tx1.json"), true);
  assert.equal(git(fixture.project, ["rev-parse", "HEAD"]), sharedHead);
  assert.equal(git(fixture.project, ["status", "--porcelain"]), "");
});

test("non-push transaction failures stop immediately instead of masquerading as CAS races", (t) => {
  const fixture = makeFixture(t);
  const result = runIsolatedTransaction(
    fixture.pmDir,
    {
      commitMessage: "must not commit",
      maxAttempts: 3,
      validate() {
        throw new Error("injected validation failure");
      },
      mutate() {
        throw new Error("unreachable");
      },
      allowedPaths() {
        return [];
      },
    },
    {}
  );

  assert.equal(result.ok, false);
  assert.equal(result.reason, "transaction-failed");
  assert.equal(result.attempts, 1);
  assert.match(result.error, /injected validation failure/);
});
