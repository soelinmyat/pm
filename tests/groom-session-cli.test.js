"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const CLI = path.resolve(__dirname, "..", "scripts", "groom-session.js");

test("Groom CLI initializes canonical private state and configures context", () => {
  const repo = makeRepo();
  try {
    const init = run(repo, [
      "init",
      "--slug",
      "cli",
      "--source-dir",
      repo,
      "--tier",
      "standard",
      "--runtime",
      "codex",
      "--json",
    ]);
    assert.equal(init.status, 0, init.stderr);
    const payload = JSON.parse(init.stdout);
    assert.equal(payload.next.phase, "intake");
    assert.equal(payload.session.execution.model, "gpt-5.6-sol");
    assert.equal(fs.statSync(payload.session_path).mode & 0o777, 0o600);
    const facts = path.join(repo, "facts.json");
    const artifact = makeOwnedArtifact(repo, "cli");
    fs.writeFileSync(
      facts,
      JSON.stringify({
        title: "CLI",
        outcome: "Safe state",
        source_kind: "idea",
        evidence_refs: [],
        artifact_repo_root: artifact,
      })
    );
    const configured = run(repo, [
      "context",
      "--session",
      payload.session_path,
      "--facts",
      facts,
      "--json",
    ]);
    assert.equal(configured.status, 0, configured.stderr);
    assert.equal(JSON.parse(configured.stdout).session.context.configured, true);
    assert.equal(run(repo, ["validate", "--session", payload.session_path]).status, 0);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("Groom CLI records exact retries idempotently and rejects copied state", () => {
  const repo = makeRepo();
  try {
    const init = JSON.parse(
      run(repo, ["init", "--slug", "retry", "--source-dir", repo, "--tier", "quick", "--json"])
        .stdout
    );
    const facts = path.join(repo, "facts.json");
    const artifact = makeOwnedArtifact(repo, "retry");
    fs.writeFileSync(
      facts,
      JSON.stringify({
        title: "Retry",
        outcome: "Idempotency",
        source_kind: "idea",
        evidence_refs: [],
        artifact_repo_root: artifact,
      })
    );
    assert.equal(
      run(repo, ["context", "--session", init.session_path, "--facts", facts]).status,
      0
    );
    const session = JSON.parse(fs.readFileSync(init.session_path, "utf8"));
    const result = path.join(repo, "result.json");
    fs.writeFileSync(result, JSON.stringify(phaseResult(session)));
    const args = ["record", "--session", init.session_path, "--result", result, "--json"];
    assert.equal(run(repo, args).status, 0);
    const retry = run(repo, args);
    assert.equal(retry.status, 0, retry.stderr);
    assert.equal(JSON.parse(retry.stdout).idempotent, true);
    const copy = path.join(repo, "copied.json");
    fs.copyFileSync(init.session_path, copy);
    const copied = run(repo, ["status", "--session", copy]);
    assert.equal(copied.status, 3);
    assert.match(copied.stderr, /noncanonical Groom session path/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("loop workers cannot record product approval", () => {
  const repo = makeRepo();
  try {
    const init = JSON.parse(
      run(repo, ["init", "--slug", "worker", "--source-dir", repo, "--json"]).stdout
    );
    const denied = run(
      repo,
      ["approve", "--session", init.session_path, "--approved-by", "worker"],
      { PM_LOOP_WORKER: "1" }
    );
    assert.equal(denied.status, 3);
    assert.match(denied.stderr, /cannot approve Groom proposals/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("Groom CLI upgrades pre-artifact-root sessions on read and resumes", () => {
  const repo = makeRepo();
  try {
    const init = JSON.parse(
      run(repo, ["init", "--slug", "legacy-resume", "--source-dir", repo, "--json"]).stdout
    );
    const legacy = JSON.parse(fs.readFileSync(init.session_path, "utf8"));
    legacy.schema_version = 1;
    legacy.context = {
      configured: true,
      tier: "standard",
      title: "Legacy session",
      outcome: "Resume safely",
      source_kind: "idea",
      source_path: null,
      evidence_refs: [],
    };
    fs.writeFileSync(init.session_path, `${JSON.stringify(legacy, null, 2)}\n`, { mode: 0o600 });

    assert.equal(run(repo, ["status", "--session", init.session_path]).status, 0);
    assert.equal(run(repo, ["next", "--session", init.session_path]).status, 0);
    const resultPath = path.join(repo, "legacy-result.json");
    fs.writeFileSync(resultPath, JSON.stringify(phaseResult(legacy)));
    assert.equal(
      run(repo, ["record", "--session", init.session_path, "--result", resultPath]).status,
      0
    );
    const upgraded = JSON.parse(fs.readFileSync(init.session_path, "utf8"));
    assert.equal(upgraded.context.artifact_repo_root, null);
    assert.equal(upgraded.phase, "research");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

function phaseResult(session) {
  return {
    schema_version: 1,
    run_id: session.run_id,
    phase: session.phase,
    attempt: session.phase_attempt,
    status: "passed",
    summary: "Intake complete",
    proposal: null,
    evidence: [{ kind: "intake", command: "test", exit_code: 0, artifact: null }],
    question_outcomes: [],
    capability_downgrades: [],
    blocker: null,
    runtime: { provider: "inline", model: "test", reasoning: "high", session_id: null },
  };
}
function run(cwd, args, env = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}
function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-groom-cli-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
  fs.writeFileSync(path.join(root, "README.md"), "test\n");
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-qm", "init"], { cwd: root });
  return root;
}

function makeOwnedArtifact(repo, slug) {
  const branch = `codex/${slug}-groom`;
  const worktree = path.join(repo, ".owned", slug);
  execFileSync("git", ["remote", "add", "origin", repo], { cwd: repo });
  execFileSync("git", ["worktree", "add", "-q", "-b", branch, worktree], { cwd: repo });
  const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
  const urlHash = crypto.createHash("sha256").update(repo).digest("hex");
  for (const [key, value] of [
    [`branch.${branch}.pmArtifactBase`, base],
    [`branch.${branch}.pmArtifactKind`, "groom"],
    [`branch.${branch}.pmArtifactRemote`, "origin"],
    [`branch.${branch}.pmArtifactDefaultBranch`, "main"],
    [`branch.${branch}.pmArtifactRemoteUrlSha256`, urlHash],
  ])
    execFileSync("git", ["config", key, value], { cwd: repo });
  return worktree;
}
