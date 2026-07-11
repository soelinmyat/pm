"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const CLI = path.resolve(__dirname, "..", "scripts", "dev-session.js");

function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-dev-session-cli-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: root });
  fs.writeFileSync(path.join(root, "README.md"), "fixture\n");
  execFileSync("git", ["add", "README.md"], { cwd: root });
  execFileSync("git", ["commit", "-m", "fixture"], { cwd: root });
  return {
    root,
    run(args, options = {}) {
      return spawnSync(process.execPath, [CLI, ...args], {
        cwd: root,
        encoding: "utf8",
        ...options,
      });
    },
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

test("init, status, next, prompt, validate, and project form a cold-process CLI", () => {
  const repo = makeRepo();
  try {
    const init = repo.run(["init", "--slug", "cli-flow", "--source-dir", repo.root, "--json"]);
    assert.equal(init.status, 0, init.stderr);
    const initialized = JSON.parse(init.stdout);
    const sessionPath = initialized.session_path;
    assert.ok(fs.existsSync(sessionPath));

    const status = repo.run(["status", "--session", sessionPath, "--json"]);
    assert.equal(status.status, 0, status.stderr);
    assert.equal(JSON.parse(status.stdout).phase, "intake");

    const next = repo.run(["next", "--session", sessionPath, "--json"]);
    assert.equal(next.status, 0, next.stderr);
    const decision = JSON.parse(next.stdout);
    assert.equal(decision.phase, "intake");
    assert.deepEqual(decision.allowed_modes, ["inline", "delegated", "headless"]);
    assert.ok(Array.isArray(decision.input_paths));
    assert.ok(Array.isArray(decision.required_capabilities));

    const promptPath = path.join(path.dirname(sessionPath), "prompt.json");
    const prompt = repo.run(["prompt", "--session", sessionPath, "--output", promptPath]);
    assert.equal(prompt.status, 0, prompt.stderr);
    const promptMetadata = JSON.parse(fs.readFileSync(promptPath, "utf8"));
    assert.equal(promptMetadata.run_id, initialized.session.run_id);
    assert.equal(promptMetadata.phase, "intake");
    assert.equal(fs.statSync(promptPath).mode & 0o777, 0o600);

    assert.equal(repo.run(["validate", "--session", sessionPath]).status, 0);
    const projected = repo.run(["project", "--session", sessionPath]);
    assert.equal(projected.status, 0, projected.stderr);
    assert.match(projected.stdout, /# Dev Session State/);
    assert.match(projected.stdout, /\| Stage \| intake \|/);
  } finally {
    repo.cleanup();
  }
});

test("record rejects mismatched results with exit 4 and preserves state", () => {
  const repo = makeRepo();
  try {
    const init = JSON.parse(
      repo.run(["init", "--slug", "record-guard", "--source-dir", repo.root, "--json"]).stdout
    );
    const resultPath = path.join(repo.root, "bad-result.json");
    fs.writeFileSync(
      resultPath,
      JSON.stringify({
        schema_version: 1,
        run_id: "wrong",
        phase: "intake",
        attempt: 1,
        status: "passed",
        summary: "Not this run",
        commit: null,
        files_changed: [],
        evidence: [],
        blocker: null,
        runtime: { provider: "inline", model: "test", reasoning: "high", session_id: null },
      })
    );
    const recorded = repo.run([
      "record",
      "--session",
      init.session_path,
      "--result",
      resultPath,
      "--json",
    ]);
    assert.equal(recorded.status, 4);
    assert.match(recorded.stderr, /run_id/);
    const state = JSON.parse(fs.readFileSync(init.session_path, "utf8"));
    assert.equal(state.phase, "intake");
    assert.equal(state.history.length, 0);
  } finally {
    repo.cleanup();
  }
});

test("route records strict intake facts and emits the durable decision", () => {
  const repo = makeRepo();
  try {
    const initialized = JSON.parse(
      repo.run(["init", "--slug", "route-cli", "--source-dir", repo.root, "--json"]).stdout
    );
    const factsPath = path.join(repo.root, "facts.json");
    fs.writeFileSync(
      factsPath,
      JSON.stringify({
        kind: "bug",
        size: "XS",
        risk: { security: 2, behavioral: 1 },
        acceptance_criteria: ["Regression is covered"],
        work_units: [],
      })
    );
    const routed = repo.run([
      "route",
      "--session",
      initialized.session_path,
      "--facts",
      factsPath,
      "--json",
    ]);
    assert.equal(routed.status, 0, routed.stderr);
    const payload = JSON.parse(routed.stdout);
    assert.equal(payload.task.risk_tier, "high");
    assert.equal(payload.routing.review_mode, "full");
    assert.ok(payload.routing.required_phases.includes("intake"));
  } finally {
    repo.cleanup();
  }
});

test("migrate writes v2 state and retains the Markdown file", () => {
  const repo = makeRepo();
  try {
    const legacy = path.join(repo.root, ".dev-epic-state-cli-legacy.md");
    fs.writeFileSync(
      legacy,
      [
        "# Legacy",
        "",
        "| Field | Value |",
        "|---|---|",
        "| Stage | review |",
        "| Repo root | " + repo.root + " |",
        "| Branch | main |",
        "",
      ].join("\n")
    );
    const migrated = repo.run(["migrate", "--legacy", legacy, "--json"]);
    assert.equal(migrated.status, 0, migrated.stderr);
    const payload = JSON.parse(migrated.stdout);
    assert.ok(fs.existsSync(payload.session_path));
    assert.ok(fs.existsSync(legacy));
    assert.equal(JSON.parse(fs.readFileSync(payload.session_path, "utf8")).phase, "review");
  } finally {
    repo.cleanup();
  }
});

test("invalid arguments and invalid state use exit code 2", () => {
  const repo = makeRepo();
  try {
    assert.equal(repo.run(["init", "--slug", "missing-source"]).status, 2);
    const invalid = path.join(repo.root, "invalid.json");
    fs.writeFileSync(invalid, "{}\n");
    const result = repo.run(["validate", "--session", invalid]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /schema_version/);
  } finally {
    repo.cleanup();
  }
});
