"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const {
  applyContext,
  approveSession,
  artifactFingerprint,
  hashResult,
  recordResult,
} = require("../scripts/lib/rfc-session-schema");
const { writeSession } = require("../scripts/rfc-session");

const CLI = path.resolve(__dirname, "..", "scripts", "rfc-session.js");

test("RFC session CLI initializes, configures context, and selects one phase", () => {
  const repo = makeRepo();
  try {
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

function prepareApprovedHandoff(repo, slug) {
  const initialized = repo.run(["init", "--slug", slug, "--source-dir", repo.root, "--json"]);
  assert.equal(initialized.status, 0, initialized.stderr);
  const payload = JSON.parse(initialized.stdout);
  let session = applyContext(payload.session, {
    source_kind: "proposal",
    proposal_path: path.join(repo.root, "proposal.md"),
    size: "M",
    acceptance_criteria: ["Archive exact approval"],
  });
  session = recordResult(session, phaseResult(session));
  let artifact = writeArtifact(repo, slug, "draft");
  session = recordResult(
    session,
    phaseResult(session, { artifact, evidence: [resultEvidence("artifact")] })
  );
  session = recordResult(
    session,
    phaseResult(session, {
      artifact,
      evidence: [resultEvidence("review")],
      reviewer_verdicts: ["architecture-risk", "test-strategy", "maintainability"].map((lens) => ({
        lens,
        artifact_hash: artifactFingerprint(artifact),
        verdict: "pass",
        blocking: [],
        advisory: [],
      })),
    })
  );
  session = approveSession(session, { approvedBy: "Test Owner" });
  artifact = writeArtifact(repo, slug, "approved", artifact);
  writeSession(payload.session_path, session);
  const artifactIdentityPath = path.join(repo.root, `${session.run_id}-artifact.json`);
  fs.writeFileSync(artifactIdentityPath, JSON.stringify(artifact));
  const audited = repo.run([
    "approval-audit",
    "--session",
    payload.session_path,
    "--artifact",
    artifactIdentityPath,
    "--json",
  ]);
  assert.equal(audited.status, 0, audited.stderr);
  const approvalPath = artifact.json_path.replace(/\.json$/i, ".approval.json");
  assert.equal(JSON.parse(audited.stdout).approval_path, approvalPath);
  assert.equal(fs.statSync(approvalPath).mode & 0o777, 0o600);
  execFileSync("git", ["add", path.relative(repo.root, approvalPath)], { cwd: repo.root });
  execFileSync("git", ["commit", "-qm", `approve ${slug}`], { cwd: repo.root });
  artifact = { ...artifact, commit: repo.head() };
  const result = phaseResult(session, {
    artifact,
    evidence: [
      resultEvidence("handoff"),
      resultEvidence("lifecycle"),
      resultEvidence("approval-audit", approvalPath),
    ],
  });
  const resultPath = path.join(repo.root, `${session.run_id}-handoff.json`);
  fs.writeFileSync(resultPath, JSON.stringify(result));
  return { runId: session.run_id, sessionPath: payload.session_path, resultPath };
}

function phaseResult(session, overrides = {}) {
  return {
    schema_version: 1,
    run_id: session.run_id,
    phase: session.phase,
    attempt: session.phase_attempt,
    status: "passed",
    summary: `Completed ${session.phase}`,
    artifact: null,
    evidence: [],
    reviewer_verdicts: [],
    blocker: null,
    runtime: { provider: "inline", model: "test", reasoning: "high", session_id: null },
    ...overrides,
  };
}

function resultEvidence(kind, artifact = null) {
  return { kind, command: "node --test", exit_code: 0, artifact };
}

function writeArtifact(repo, slug, status, prior = null) {
  const jsonPath = prior?.json_path || path.join(repo.root, `${slug}.json`);
  const htmlPath = prior?.html_path || path.join(repo.root, `${slug}.html`);
  if (!prior) {
    const sidecar = {
      schema_version: 3,
      slug,
      title: "Immutable RFC",
      size: "M",
      issues: [
        {
          num: 1,
          title: "Archive approval",
          size: "M",
          depends_on: [],
          owns: ["README.md"],
          acceptance_criteria: ["Approval history is immutable"],
          approach: "Archive every run by run ID.",
          verification_commands: ["node --test"],
          test_hooks: ["Approval history"],
        },
      ],
      test_strategy: {
        test_levels: "CLI integration",
        new_infrastructure: "None",
        regression_surface: "RFC sessions",
        verification_commands: "node --test",
        open_questions: "None",
      },
    };
    fs.writeFileSync(jsonPath, `${JSON.stringify(sidecar)}\n`);
  }
  const sidecarHash = `sha256:${crypto
    .createHash("sha256")
    .update(fs.readFileSync(jsonPath))
    .digest("hex")}`;
  fs.writeFileSync(
    htmlPath,
    [
      "<!doctype html>",
      '<html lang="en">',
      "<head>",
      '  <meta charset="utf-8">',
      '  <meta name="viewport" content="width=device-width, initial-scale=1">',
      "  <title>Immutable RFC</title>",
      `  <script id="pm-artifact" type="application/json">{"schema_version":1,"id":"rfc:${slug}","kind":"rfc","slug":"${slug}","lifecycle":"${status}","title":"Immutable RFC","generated_at":"2026-07-12T00:00:00Z","generator":{"name":"pm:rfc","version":"test"},"source":{"path":"proposal.md","sha256":null},"evidence":[]}</script>`,
      "  <style>:focus-visible{outline:2px solid currentColor}@media(max-width:700px){main{padding:1rem}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto}}@media print{*{overflow:visible!important}}</style>",
      "</head>",
      "<body>",
      `  <script id="rfc-lifecycle" type="application/json">{"status":"${status}"}</script>`,
      '  <a class="skip-link" href="#content">Skip to content</a>',
      '  <nav aria-label="RFC sections"><a href="#brief">Brief</a></nav>',
      `  <main id="content" data-sidecar-hash="${sidecarHash}">`,
      "  <h1>Immutable RFC</h1>",
      `  <p>Status: <span data-pm-lifecycle>${status[0].toUpperCase()}${status.slice(1)}</span></p>`,
      '  <section id="brief"></section>',
      '  <section id="execution-contract"></section>',
      '  <section id="appendix"></section>',
      '  <section id="test-strategy" class="test-strategy"><div class="test-strategy-block"></div></section>',
      '  <article class="issue-detail"><span class="issue-detail-num">1</span><span class="issue-detail-title">Archive approval</span><span class="issue-detail-size">M</span><span class="hooks-badge">Approval history</span></article>',
      "  </main>",
      "</body>",
      "</html>",
      "",
    ].join("\n")
  );
  execFileSync(
    "git",
    ["add", path.relative(repo.root, jsonPath), path.relative(repo.root, htmlPath)],
    {
      cwd: repo.root,
    }
  );
  execFileSync("git", ["commit", "-qm", `${status} ${slug}`], { cwd: repo.root });
  return {
    html_path: htmlPath,
    json_path: jsonPath,
    html_hash: `sha256:${crypto.createHash("sha256").update(fs.readFileSync(htmlPath)).digest("hex")}`,
    sidecar_hash: sidecarHash,
    repo_root: repo.root,
    commit: repo.head(),
  };
}

function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-rfc-cli-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
  fs.writeFileSync(path.join(root, "proposal.md"), "proposal\n");
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root });
  return {
    root,
    head() {
      return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    },
    run(args, env = {}) {
      return spawnSync(process.execPath, [CLI, ...args], {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, ...env },
      });
    },
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
