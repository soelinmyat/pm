"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

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
    run(args) {
      return spawnSync(process.execPath, [CLI, ...args], { cwd: root, encoding: "utf8" });
    },
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
