"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const { hashResult } = require("../scripts/lib/rfc-session-schema");
const {
  amendArtifact,
  currentDesignContext,
  makeRfcRepo: makeRepo,
  passingVerdicts,
  phaseResult,
  prepareApprovedHandoff,
  recordFile,
  relabelArtifact,
  resultEvidence,
  snapshotDir,
} = require("./helpers/rfc-run-fixture");

const CLI = path.resolve(__dirname, "..", "scripts", "rfc-session.js");

test("RFC session CLI initializes, configures context, and selects one phase", () => {
  const repo = makeRepo();
  try {
    repo.own("cli-rfc");
    const init = repo.run(["init", "--slug", "cli-rfc", "--source-dir", repo.root, "--json"]);
    assert.equal(init.status, 0, init.stderr);
    const payload = JSON.parse(init.stdout);
    assert.equal(payload.next.phase, "intake");
    assert.equal(fs.statSync(payload.session_path).mode & 0o777, 0o600);

    const facts = path.join(repo.root, "facts.json");
    fs.writeFileSync(
      facts,
      JSON.stringify({
        source_kind: "proposal",
        proposal_path: path.join(repo.root, "proposal.md"),
        size: "M",
        acceptance_criteria: ["Explicit approval"],
        design_context: currentDesignContext(),
        artifact_repo_root: repo.root,
      })
    );
    const configured = repo.run([
      "context",
      "--session",
      payload.session_path,
      "--facts",
      facts,
      "--json",
    ]);
    assert.equal(configured.status, 0, configured.stderr);
    assert.equal(JSON.parse(configured.stdout).session.context.size, "M");

    const next = repo.run(["next", "--session", payload.session_path, "--json"]);
    assert.equal(next.status, 0, next.stderr);
    assert.equal(JSON.parse(next.stdout).instruction_path, "skills/rfc/steps/01-intake.md");
    assert.equal(repo.run(["validate", "--session", payload.session_path]).status, 0);
  } finally {
    repo.cleanup();
  }
});

test("RFC session CLI recertifies an upgraded in-flight session back through intake", () => {
  const repo = makeRepo();
  try {
    repo.own("legacy-recertify");
    const initialized = JSON.parse(
      repo.run(["init", "--slug", "legacy-recertify", "--source-dir", repo.root, "--json"]).stdout
    );
    const factsPath = path.join(repo.root, "recertify-facts.json");
    fs.writeFileSync(
      factsPath,
      JSON.stringify({
        source_kind: "proposal",
        proposal_path: path.join(repo.root, "proposal.md"),
        size: "M",
        acceptance_criteria: ["Legacy work keeps its approved design intent"],
        design_context: currentDesignContext(),
        artifact_repo_root: repo.root,
      })
    );
    assert.equal(
      repo.run(["context", "--session", initialized.session_path, "--facts", factsPath]).status,
      0
    );
    const legacy = JSON.parse(fs.readFileSync(initialized.session_path, "utf8"));
    legacy.phase = "generation";
    delete legacy.context.design_context;
    fs.writeFileSync(initialized.session_path, `${JSON.stringify(legacy, null, 2)}\n`, {
      mode: 0o600,
    });

    const blocked = repo.run(["next", "--session", initialized.session_path]);
    assert.notEqual(blocked.status, 0);
    assert.match(blocked.stderr, /legacy unbound design_context/);

    const recertified = repo.run([
      "recertify",
      "--session",
      initialized.session_path,
      "--facts",
      factsPath,
      "--json",
    ]);
    assert.equal(recertified.status, 0, recertified.stderr);
    const payload = JSON.parse(recertified.stdout);
    assert.equal(payload.session.phase, "intake");
    assert.deepEqual(payload.session.context.design_context, currentDesignContext());
    assert.equal(payload.next.phase, "intake");
    assert.match(payload.session.history.at(-1).reason, /recertification invalidated/i);
  } finally {
    repo.cleanup();
  }
});

test("RFC CLI rejects Astra model laundering and accepts ultra effort", () => {
  const repo = makeRepo();
  try {
    const cases = [
      [
        "non-astra-base",
        "--profile",
        "gpt-5.6-sol-high",
        "--model",
        "gpt-6-astra",
        /requires an explicitly selected named base profile/,
      ],
      [
        "astra-model-swap",
        "--profile",
        "gpt-6-astra-high",
        "--model",
        "gpt-5.6-sol",
        /cannot override model identity/,
      ],
    ];
    for (const [slug, ...rest] of cases) {
      const pattern = rest.pop();
      const result = repo.run([
        "init",
        "--slug",
        slug,
        "--source-dir",
        repo.root,
        "--runtime",
        "codex",
        ...rest,
      ]);
      assert.equal(result.status, 3, result.stderr);
      assert.match(result.stderr, pattern);
    }

    const astra = repo.run([
      "init",
      "--slug",
      "astra-ultra",
      "--source-dir",
      repo.root,
      "--runtime",
      "codex",
      "--profile",
      "gpt-6-astra-high",
      "--reasoning",
      "ultra",
      "--json",
    ]);
    assert.equal(astra.status, 0, astra.stderr);
    assert.equal(JSON.parse(astra.stdout).session.execution.reasoning, "ultra");
  } finally {
    repo.cleanup();
  }
});

test("RFC session CLI rejects non-Git initialization with precondition exit", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-rfc-no-git-"));
  try {
    const result = spawnSync(
      process.execPath,
      [CLI, "init", "--slug", "bad", "--source-dir", dir],
      { encoding: "utf8" }
    );
    assert.equal(result.status, 3);
    assert.match(result.stderr, /not a Git worktree/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("record retries are idempotent after an atomic phase advance", () => {
  const repo = makeRepo();
  try {
    repo.own("retry");
    const init = JSON.parse(
      repo.run(["init", "--slug", "retry", "--source-dir", repo.root, "--json"]).stdout
    );
    const facts = path.join(repo.root, "facts.json");
    fs.writeFileSync(
      facts,
      JSON.stringify({
        source_kind: "proposal",
        proposal_path: path.join(repo.root, "proposal.md"),
        size: "M",
        acceptance_criteria: ["Retry safely"],
        design_context: currentDesignContext(),
        artifact_repo_root: repo.root,
      })
    );
    assert.equal(repo.run(["context", "--session", init.session_path, "--facts", facts]).status, 0);
    const session = JSON.parse(fs.readFileSync(init.session_path, "utf8"));
    const resultPath = path.join(repo.root, "result.json");
    fs.writeFileSync(
      resultPath,
      JSON.stringify({
        schema_version: 1,
        run_id: session.run_id,
        phase: "intake",
        attempt: 1,
        status: "passed",
        summary: "Intake complete",
        artifact: null,
        evidence: [],
        reviewer_verdicts: [],
        blocker: null,
        runtime: { provider: "inline", model: "test", reasoning: "high", session_id: null },
      })
    );
    const args = ["record", "--session", init.session_path, "--result", resultPath, "--json"];
    assert.equal(repo.run(args).status, 0);
    const retry = repo.run(args);
    assert.equal(retry.status, 0, retry.stderr);
    assert.equal(JSON.parse(retry.stdout).idempotent, true);
    assert.equal(JSON.parse(fs.readFileSync(init.session_path, "utf8")).attempts.length, 1);
  } finally {
    repo.cleanup();
  }
});

test("exact retries of persisted blocked results remain idempotent", () => {
  const repo = makeRepo();
  try {
    repo.own("blocked-retry");
    const init = JSON.parse(
      repo.run(["init", "--slug", "blocked-retry", "--source-dir", repo.root, "--json"]).stdout
    );
    const facts = path.join(repo.root, "facts.json");
    fs.writeFileSync(
      facts,
      JSON.stringify({
        source_kind: "proposal",
        proposal_path: path.join(repo.root, "proposal.md"),
        size: "M",
        acceptance_criteria: ["Retry blocked writes safely"],
        design_context: currentDesignContext(),
        artifact_repo_root: repo.root,
      })
    );
    assert.equal(repo.run(["context", "--session", init.session_path, "--facts", facts]).status, 0);
    const session = JSON.parse(fs.readFileSync(init.session_path, "utf8"));
    const resultPath = path.join(repo.root, "blocked-result.json");
    fs.writeFileSync(
      resultPath,
      JSON.stringify({
        ...phaseResult(session),
        status: "blocked",
        summary: "Waiting on an external decision",
        blocker: {
          code: "decision-required",
          reason: "Owner decision is missing",
          remediation: "Ask the owner",
        },
      })
    );
    const args = ["record", "--session", init.session_path, "--result", resultPath, "--json"];
    assert.equal(repo.run(args).status, 5);
    const retry = repo.run(args);
    assert.equal(retry.status, 5, retry.stderr);
    assert.equal(JSON.parse(retry.stdout).idempotent, true);
    assert.equal(JSON.parse(fs.readFileSync(init.session_path, "utf8")).attempts.length, 1);
  } finally {
    repo.cleanup();
  }
});

test("exact retry of retry-budget exhaustion remains idempotent", () => {
  const repo = makeRepo();
  try {
    repo.own("budget-retry");
    const init = JSON.parse(
      repo.run(["init", "--slug", "budget-retry", "--source-dir", repo.root, "--json"]).stdout
    );
    const facts = path.join(repo.root, "facts.json");
    fs.writeFileSync(
      facts,
      JSON.stringify({
        source_kind: "proposal",
        proposal_path: path.join(repo.root, "proposal.md"),
        size: "M",
        acceptance_criteria: ["Bound retries"],
        design_context: currentDesignContext(),
        artifact_repo_root: repo.root,
      })
    );
    assert.equal(repo.run(["context", "--session", init.session_path, "--facts", facts]).status, 0);
    let finalArgs;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const session = JSON.parse(fs.readFileSync(init.session_path, "utf8"));
      const resultPath = path.join(repo.root, `failed-${attempt}.json`);
      fs.writeFileSync(
        resultPath,
        JSON.stringify({ ...phaseResult(session), status: "failed", summary: `Failure ${attempt}` })
      );
      finalArgs = ["record", "--session", init.session_path, "--result", resultPath, "--json"];
      assert.equal(repo.run(finalArgs).status, attempt === 3 ? 5 : 0);
    }
    const retry = repo.run(finalArgs);
    assert.equal(retry.status, 5, retry.stderr);
    assert.equal(JSON.parse(retry.stdout).idempotent, true);
    assert.equal(JSON.parse(fs.readFileSync(init.session_path, "utf8")).attempts.length, 3);
  } finally {
    repo.cleanup();
  }
});

test("CLI rejects noncanonical copied session paths", () => {
  const repo = makeRepo();
  try {
    const init = JSON.parse(
      repo.run(["init", "--slug", "canonical", "--source-dir", repo.root, "--json"]).stdout
    );
    const copy = path.join(repo.root, "copied-session.json");
    fs.copyFileSync(init.session_path, copy);
    const result = repo.run(["status", "--session", copy]);
    assert.equal(result.status, 3);
    assert.match(result.stderr, /noncanonical RFC session path/);
  } finally {
    repo.cleanup();
  }
});

test("init respects an exclusive creation lock for the slug", () => {
  const repo = makeRepo();
  try {
    const sessionDir = path.join(repo.root, ".pm", "rfc-sessions", "locked");
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(path.join(sessionDir, "session.json.lock"), "other-worker\n");
    const result = repo.run(["init", "--slug", "locked", "--source-dir", repo.root]);
    assert.equal(result.status, 3);
    assert.match(result.stderr, /session is locked/);
  } finally {
    repo.cleanup();
  }
});

test("a live old lock cannot be stolen and a dead owner is recovered", () => {
  const repo = makeRepo();
  try {
    const liveDir = path.join(repo.root, ".pm", "rfc-sessions", "live-old");
    fs.mkdirSync(liveDir, { recursive: true });
    const liveLock = path.join(liveDir, "session.json.lock");
    fs.writeFileSync(
      liveLock,
      JSON.stringify({
        pid: process.pid,
        token: "live-owner",
        created_at: new Date().toISOString(),
      })
    );
    fs.utimesSync(liveLock, new Date(0), new Date(0));
    const blocked = repo.run(["init", "--slug", "live-old", "--source-dir", repo.root]);
    assert.equal(blocked.status, 3);
    assert.ok(fs.existsSync(liveLock));

    const deadDir = path.join(repo.root, ".pm", "rfc-sessions", "dead-old");
    fs.mkdirSync(deadDir, { recursive: true });
    const deadLock = path.join(deadDir, "session.json.lock");
    fs.writeFileSync(
      deadLock,
      JSON.stringify({
        pid: 2147483647,
        token: "dead-owner",
        created_at: new Date(0).toISOString(),
      })
    );
    const recovered = repo.run(["init", "--slug", "dead-old", "--source-dir", repo.root]);
    assert.equal(recovered.status, 0, recovered.stderr);
  } finally {
    repo.cleanup();
  }
});

test("loop worker environment cannot invoke the explicit approval command", () => {
  const repo = makeRepo();
  try {
    const init = JSON.parse(
      repo.run(["init", "--slug", "headless", "--source-dir", repo.root, "--json"]).stdout
    );
    const result = repo.run(
      ["approve", "--session", init.session_path, "--approved-by", "worker"],
      { PM_LOOP_WORKER: "1" }
    );
    assert.equal(result.status, 3);
    assert.match(result.stderr, /loop workers cannot approve/);
  } finally {
    repo.cleanup();
  }
});

test("a historical matching hash does not suppress a current phase attempt", () => {
  const repo = makeRepo();
  try {
    repo.own("phase-replay");
    const init = JSON.parse(
      repo.run(["init", "--slug", "phase-replay", "--source-dir", repo.root, "--json"]).stdout
    );
    const facts = path.join(repo.root, "facts-replay.json");
    fs.writeFileSync(
      facts,
      JSON.stringify({
        source_kind: "proposal",
        proposal_path: path.join(repo.root, "proposal.md"),
        size: "M",
        acceptance_criteria: ["Replay current phase"],
        design_context: currentDesignContext(),
        artifact_repo_root: repo.root,
      })
    );
    assert.equal(repo.run(["context", "--session", init.session_path, "--facts", facts]).status, 0);
    const session = JSON.parse(fs.readFileSync(init.session_path, "utf8"));
    const result = {
      schema_version: 1,
      run_id: session.run_id,
      phase: "intake",
      attempt: 1,
      status: "passed",
      summary: "Intake complete",
      artifact: null,
      evidence: [],
      reviewer_verdicts: [],
      blocker: null,
      runtime: { provider: "inline", model: "test", reasoning: "high", session_id: null },
    };
    session.attempts.push({
      phase: "intake",
      attempt: 1,
      status: "passed",
      summary: "Historical matching result",
      artifact_hash: null,
      recorded_at: session.updated_at,
      runtime: result.runtime,
      result_hash: hashResult(result),
    });
    fs.writeFileSync(init.session_path, JSON.stringify(session));
    const resultPath = path.join(repo.root, "phase-replay-result.json");
    fs.writeFileSync(resultPath, JSON.stringify(result));
    const recorded = repo.run([
      "record",
      "--session",
      init.session_path,
      "--result",
      resultPath,
      "--json",
    ]);
    assert.equal(recorded.status, 0, recorded.stderr);
    const payload = JSON.parse(recorded.stdout);
    assert.equal(payload.idempotent, false);
    assert.equal(payload.session.phase, "generation");
    assert.equal(payload.session.attempts.length, 2);
  } finally {
    repo.cleanup();
  }
});

test("terminal RFC runs archive immutably and retry across the archive boundary", () => {
  const repo = makeRepo();
  try {
    const first = prepareApprovedHandoff(repo, "immutable-rfc");
    const firstRecord = repo.run([
      "record",
      "--session",
      first.sessionPath,
      "--result",
      first.resultPath,
      "--json",
    ]);
    assert.equal(firstRecord.status, 0, firstRecord.stderr);
    const firstArchive = JSON.parse(firstRecord.stdout).session_path;
    assert.match(
      firstArchive,
      new RegExp(`completed/immutable-rfc/${first.runId}/session\\.json$`)
    );
    const retry = repo.run([
      "record",
      "--session",
      first.sessionPath,
      "--result",
      first.resultPath,
      "--json",
    ]);
    assert.equal(retry.status, 0, retry.stderr);
    assert.equal(JSON.parse(retry.stdout).idempotent, true);

    const second = prepareApprovedHandoff(repo, "immutable-rfc");
    const secondRecord = repo.run([
      "record",
      "--session",
      second.sessionPath,
      "--result",
      second.resultPath,
      "--json",
    ]);
    assert.equal(secondRecord.status, 0, secondRecord.stderr);
    const secondArchive = JSON.parse(secondRecord.stdout).session_path;
    assert.notEqual(secondArchive, firstArchive);
    assert.ok(fs.existsSync(firstArchive));
    assert.ok(fs.existsSync(secondArchive));
    assert.equal(
      fs.readdirSync(path.join(repo.root, ".pm", "rfc-sessions", "completed", "immutable-rfc"))
        .length,
      2
    );
  } finally {
    repo.cleanup();
  }
});

test("post-handoff amendment re-reviews owns-only changes and archives a v2 approval lineage", () => {
  const repo = makeRepo();
  try {
    const slug = "amend-rfc";
    const first = prepareApprovedHandoff(repo, slug);
    const firstRecord = repo.run([
      "record",
      "--session",
      first.sessionPath,
      "--result",
      first.resultPath,
      "--json",
    ]);
    assert.equal(firstRecord.status, 0, firstRecord.stderr);
    const firstArchive = JSON.parse(firstRecord.stdout).session_path;
    const archived = JSON.parse(fs.readFileSync(firstArchive, "utf8"));
    const archiveSnapshot = snapshotDir(path.dirname(firstArchive));
    const amendArgs = [
      "amend",
      "--kind",
      "owns-only",
      "--completed",
      firstArchive,
      "--source-dir",
      repo.root,
      "--issues",
      "1",
      "--reason",
      "issue 1 verification edits docs/extra.md",
      "--json",
    ];

    const missingIssues = repo.run(
      amendArgs.filter((arg, index) => arg !== "--issues" && amendArgs[index - 1] !== "--issues")
    );
    assert.equal(missingIssues.status, 2);
    assert.match(missingIssues.stderr, /--issues is required/);
    const loopWorker = repo.run(amendArgs, { PM_LOOP_WORKER: "1" });
    assert.equal(loopWorker.status, 3);
    assert.match(loopWorker.stderr, /loop workers cannot amend/);

    const amended = repo.run(amendArgs);
    assert.equal(amended.status, 0, amended.stderr);
    const payload = JSON.parse(amended.stdout);
    let session = payload.session;
    assert.equal(payload.session_path, first.sessionPath);
    assert.notEqual(session.run_id, first.runId);
    assert.equal(session.phase, "review");
    assert.equal(session.status, "active");
    assert.equal(session.approval.status, "pending");
    assert.equal(session.review.status, "not_started");
    assert.deepEqual(Object.values(session.authority), [false, false, false, false]);
    assert.equal(session.amendment.of_run_id, first.runId);
    assert.deepEqual(session.amendment.amended_issue_nums, [1]);
    assert.equal(session.amendment.prior_artifact.sidecar_hash, archived.artifact.sidecar_hash);
    assert.equal(session.amendment.prior_artifact.commit, archived.artifact.commit);
    assert.equal(payload.next.phase, "review");

    const concurrent = repo.run(amendArgs);
    assert.equal(concurrent.status, 3);
    assert.match(concurrent.stderr, /active RFC session already exists/);
    const authorize = repo.run([
      "authorize",
      "--session",
      first.sessionPath,
      "--action",
      "linear_create",
      "--reason",
      "not allowed",
    ]);
    assert.equal(authorize.status, 4);
    assert.match(authorize.stderr, /amendment runs grant no new authority/);

    const widened = amendArtifact(repo, slug, archived.artifact, (sidecar) => {
      sidecar.issues[0].owns = ["docs/extra.md"];
    });
    const rejected = recordFile(
      repo,
      session,
      phaseResult(session, {
        artifact: widened,
        evidence: [resultEvidence("review")],
        reviewer_verdicts: passingVerdicts(widened),
      })
    );
    assert.equal(rejected.status, 4, rejected.stderr);
    assert.match(rejected.stderr, /append-only/);

    const artifact = amendArtifact(repo, slug, archived.artifact, (sidecar) => {
      sidecar.issues[0].owns = ["README.md", "docs/extra.md"];
    });
    const reviewed = recordFile(
      repo,
      session,
      phaseResult(session, {
        artifact,
        evidence: [resultEvidence("review")],
        reviewer_verdicts: passingVerdicts(artifact),
      })
    );
    assert.equal(reviewed.status, 0, reviewed.stderr);
    session = JSON.parse(reviewed.stdout).session;
    assert.equal(session.phase, "approval");

    const approveArgs = ["approve", "--session", first.sessionPath, "--approved-by", "Owner"];
    const unconfirmed = repo.run(approveArgs);
    assert.equal(unconfirmed.status, 4);
    assert.match(unconfirmed.stderr, /--approved-sidecar-sha256/);
    const wrongHash = repo.run([
      ...approveArgs,
      "--approved-sidecar-sha256",
      archived.artifact.sidecar_hash,
    ]);
    assert.equal(wrongHash.status, 4);
    assert.match(wrongHash.stderr, /does not match the reviewed amendment sidecar/);
    const approvedRun = repo.run([
      ...approveArgs,
      "--approved-sidecar-sha256",
      artifact.sidecar_hash,
      "--json",
    ]);
    assert.equal(approvedRun.status, 0, approvedRun.stderr);
    session = JSON.parse(approvedRun.stdout).session;
    assert.equal(session.phase, "handoff");

    let approvedArtifact = relabelArtifact(repo, slug, artifact, "approved");
    const identityPath = path.join(repo.root, `${session.run_id}-artifact.json`);
    fs.writeFileSync(identityPath, JSON.stringify(approvedArtifact));
    const audited = repo.run([
      "approval-audit",
      "--session",
      first.sessionPath,
      "--artifact",
      identityPath,
      "--json",
    ]);
    assert.equal(audited.status, 0, audited.stderr);
    const audit = JSON.parse(audited.stdout).approval;
    const approvalPath = approvedArtifact.json_path.replace(/\.json$/i, ".approval.json");
    const priorAuditBytes = execFileSync(
      "git",
      ["show", `${archived.artifact.commit}:${path.basename(approvalPath)}`],
      { cwd: repo.root }
    );
    assert.equal(audit.schema_version, 2);
    assert.equal(audit.run_id, session.run_id);
    assert.deepEqual(audit.amends, {
      run_id: first.runId,
      approval_sha256: `sha256:${crypto.createHash("sha256").update(priorAuditBytes).digest("hex")}`,
      sidecar_sha256: archived.artifact.sidecar_hash,
      html_sha256: archived.artifact.html_hash,
    });
    assert.deepEqual(audit.amended_issue_nums, [1]);
    assert.equal(audit.reason, "issue 1 verification edits docs/extra.md");
    execFileSync("git", ["add", path.basename(approvalPath)], { cwd: repo.root });
    execFileSync("git", ["commit", "-qm", "approve amendment"], { cwd: repo.root });
    approvedArtifact = { ...approvedArtifact, commit: repo.head() };
    const handoff = recordFile(
      repo,
      session,
      phaseResult(session, {
        artifact: approvedArtifact,
        evidence: [
          resultEvidence("handoff"),
          resultEvidence("lifecycle"),
          resultEvidence("approval-audit", approvalPath),
        ],
      })
    );
    assert.equal(handoff.status, 0, handoff.stderr);
    const secondArchive = JSON.parse(handoff.stdout).session_path;
    assert.match(secondArchive, new RegExp(`completed/${slug}/${session.run_id}/session\\.json$`));
    assert.deepEqual(snapshotDir(path.dirname(firstArchive)), archiveSnapshot);

    const stale = repo.run(amendArgs);
    assert.equal(stale.status, 3);
    assert.match(stale.stderr, new RegExp(`already amended by ${session.run_id}`));
    const next = repo.run([
      "amend",
      "--kind",
      "owns-only",
      "--completed",
      secondArchive,
      "--source-dir",
      repo.root,
      "--issues",
      "1",
      "--reason",
      "chain a second amendment",
      "--json",
    ]);
    assert.equal(next.status, 0, next.stderr);
    assert.equal(JSON.parse(next.stdout).session.amendment.of_run_id, session.run_id);
  } finally {
    repo.cleanup();
  }
});

test("amend refuses archives whose committed approval audit no longer matches", () => {
  const repo = makeRepo();
  try {
    const first = prepareApprovedHandoff(repo, "tampered-rfc");
    const recorded = repo.run([
      "record",
      "--session",
      first.sessionPath,
      "--result",
      first.resultPath,
      "--json",
    ]);
    assert.equal(recorded.status, 0, recorded.stderr);
    const archivePath = JSON.parse(recorded.stdout).session_path;
    const archived = JSON.parse(fs.readFileSync(archivePath, "utf8"));
    archived.approval.approved_by = "Someone Else";
    fs.writeFileSync(archivePath, JSON.stringify(archived));
    const amended = repo.run([
      "amend",
      "--kind",
      "owns-only",
      "--completed",
      archivePath,
      "--source-dir",
      repo.root,
      "--issues",
      "1",
      "--reason",
      "tampered",
    ]);
    assert.equal(amended.status, 3);
    assert.match(amended.stderr, /approval audit/);
    const unknownIssue = repo.run([
      "amend",
      "--kind",
      "owns-only",
      "--completed",
      archivePath,
      "--source-dir",
      repo.root,
      "--issues",
      "7",
      "--reason",
      "missing issue",
    ]);
    assert.equal(unknownIssue.status, 3);
  } finally {
    repo.cleanup();
  }
});
