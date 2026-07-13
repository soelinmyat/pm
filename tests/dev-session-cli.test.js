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
    assert.equal(decision.instruction_path, "skills/dev/steps/02-intake.md");
    assert.deepEqual(decision.allowed_modes, ["inline"]);
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

test("init rejects a source directory outside a Git worktree as a precondition", () => {
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-dev-non-git-"));
  try {
    const result = spawnSync(
      process.execPath,
      [CLI, "init", "--slug", "not-git", "--source-dir", sourceDir],
      { encoding: "utf8" }
    );
    assert.equal(result.status, 3);
    assert.match(result.stderr, /not a Git worktree/);
  } finally {
    fs.rmSync(sourceDir, { recursive: true, force: true });
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
        evidence: [{ kind: "intake", command: "fixture", exit_code: 0, artifact: null }],
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

test("record is idempotent when a caller retries after the atomic write", () => {
  const repo = makeRepo();
  try {
    const initialized = JSON.parse(
      repo.run(["init", "--slug", "record-idempotent", "--source-dir", repo.root, "--json"]).stdout
    );
    const resultPath = path.join(repo.root, "result.json");
    fs.writeFileSync(
      resultPath,
      JSON.stringify({
        schema_version: 1,
        run_id: initialized.session.run_id,
        phase: "intake",
        attempt: 1,
        status: "passed",
        summary: "Intake complete",
        commit: null,
        files_changed: [],
        evidence: [{ kind: "intake", command: "fixture", exit_code: 0, artifact: null }],
        blocker: null,
        runtime: { provider: "inline", model: "test", reasoning: "high", session_id: null },
      })
    );
    const args = [
      "record",
      "--session",
      initialized.session_path,
      "--result",
      resultPath,
      "--json",
    ];
    assert.equal(repo.run(args).status, 0);
    const retried = repo.run(args);
    assert.equal(retried.status, 0, retried.stderr);
    assert.equal(JSON.parse(retried.stdout).idempotent, true);

    assert.equal(JSON.parse(fs.readFileSync(initialized.session_path, "utf8")).history.length, 1);
  } finally {
    repo.cleanup();
  }
});

test("completion moves the durable audit out of the active-session scan path", () => {
  const repo = makeRepo();
  try {
    const initialized = JSON.parse(
      repo.run(["init", "--slug", "archive-cli", "--source-dir", repo.root, "--json"]).stdout
    );
    const session = JSON.parse(fs.readFileSync(initialized.session_path, "utf8"));
    session.phase = "retro";
    session.routing.required_phases = ["retro"];
    session.routing.required_gates = [];
    fs.writeFileSync(initialized.session_path, JSON.stringify(session));
    const activeDir = path.dirname(initialized.session_path);
    fs.writeFileSync(
      path.join(activeDir, "gates.json"),
      JSON.stringify({
        run_id: session.run_id,
        gates: [{ artifact: ".pm/dev-sessions/archive-cli/review.log" }],
      })
    );
    fs.writeFileSync(path.join(activeDir, "review.log"), "review evidence\n");
    const semanticJson = `${JSON.stringify({
      summary: ".pm/dev-sessions/archive-cli/this is prose, not a path field",
    })}\n`;
    fs.writeFileSync(path.join(activeDir, "semantic.json"), semanticJson);
    const resultPath = path.join(repo.root, "retro-result.json");
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
    const recorded = repo.run([
      "record",
      "--session",
      initialized.session_path,
      "--result",
      resultPath,
      "--json",
    ]);
    assert.equal(recorded.status, 0, recorded.stderr);
    const archived = JSON.parse(recorded.stdout).session_path;
    assert.match(archived, /dev-sessions\/completed\/archive-cli\/dev_[^/]+\/session\.json$/);
    assert.ok(fs.existsSync(archived));
    assert.ok(fs.existsSync(path.join(path.dirname(archived), "gates.json")));
    assert.ok(fs.existsSync(path.join(path.dirname(archived), "review.log")));
    assert.equal(
      fs.readFileSync(path.join(path.dirname(archived), "semantic.json"), "utf8"),
      semanticJson,
      "unregistered JSON artifacts remain byte-for-byte intact"
    );
    assert.match(
      JSON.parse(fs.readFileSync(path.join(path.dirname(archived), "gates.json"), "utf8")).gates[0]
        .artifact,
      /dev-sessions\/completed\/archive-cli\/dev_[^/]+\/review\.log$/
    );
    assert.equal(fs.existsSync(initialized.session_path), false);
    assert.ok(fs.existsSync(path.join(path.dirname(initialized.session_path), "completion.json")));
    const retried = repo.run([
      "record",
      "--session",
      initialized.session_path,
      "--result",
      resultPath,
      "--json",
    ]);
    assert.equal(retried.status, 0, retried.stderr);
    assert.equal(JSON.parse(retried.stdout).idempotent, true);
    fs.rmSync(path.join(activeDir, "completion.json"));
    const recoveredWithoutPointer = repo.run([
      "record",
      "--session",
      initialized.session_path,
      "--result",
      resultPath,
      "--json",
    ]);
    assert.equal(recoveredWithoutPointer.status, 0, recoveredWithoutPointer.stderr);
    assert.equal(JSON.parse(recoveredWithoutPointer.stdout).idempotent, true);

    const second = JSON.parse(
      repo.run(["init", "--slug", "archive-cli", "--source-dir", repo.root, "--json"]).stdout
    );
    const secondSession = JSON.parse(fs.readFileSync(second.session_path, "utf8"));
    secondSession.phase = "retro";
    secondSession.routing.required_phases = ["retro"];
    secondSession.routing.required_gates = [];
    fs.writeFileSync(second.session_path, JSON.stringify(secondSession));
    fs.writeFileSync(
      resultPath,
      JSON.stringify({
        schema_version: 1,
        run_id: secondSession.run_id,
        phase: "retro",
        attempt: 1,
        status: "passed",
        summary: "Second retro complete",
        commit: null,
        files_changed: [],
        evidence: [{ kind: "retro", command: "retro", exit_code: 0, artifact: null }],
        blocker: null,
        runtime: { provider: "inline", model: "test", reasoning: "high" },
      })
    );
    const secondRecorded = repo.run([
      "record",
      "--session",
      second.session_path,
      "--result",
      resultPath,
      "--json",
    ]);
    assert.equal(secondRecorded.status, 0, secondRecorded.stderr);
    const archiveRoot = path.join(repo.root, ".pm", "dev-sessions", "completed", "archive-cli");
    assert.equal(fs.readdirSync(archiveRoot).length, 2);
    assert.ok(fs.existsSync(archived), "the first immutable audit remains present");
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

test("advance-decision records explicit direction and rejects a stale expected version", () => {
  const repo = makeRepo();
  try {
    const initialized = JSON.parse(
      repo.run(["init", "--slug", "decision-cli", "--source-dir", repo.root, "--json"]).stdout
    );
    const advanced = repo.run([
      "advance-decision",
      "--session",
      initialized.session_path,
      "--expected-version",
      "1",
      "--reason",
      "User stopped the stale review lineage",
      "--json",
    ]);
    assert.equal(advanced.status, 0, advanced.stderr);
    const payload = JSON.parse(advanced.stdout);
    assert.equal(payload.decision_version, 2);
    assert.equal(payload.decision.reason, "User stopped the stale review lineage");
    const stale = repo.run([
      "advance-decision",
      "--session",
      initialized.session_path,
      "--expected-version",
      "1",
      "--reason",
      "Stale retry",
    ]);
    assert.equal(stale.status, 3);
    assert.match(stale.stderr, /expected 1, observed 2/);
  } finally {
    repo.cleanup();
  }
});

test("route converts an RFC schema-v3 sidecar into the persisted Dev DAG", () => {
  const repo = makeRepo();
  try {
    const initialized = JSON.parse(
      repo.run(["init", "--slug", "rfc-route-cli", "--source-dir", repo.root, "--json"]).stdout
    );
    const factsPath = path.join(repo.root, "facts.json");
    fs.writeFileSync(
      factsPath,
      JSON.stringify({
        reference: "PM-123",
        kind: "proposal",
        size: "L",
        risk: {},
        acceptance_criteria: ["AC-1"],
      })
    );
    const sidecarPath = path.join(repo.root, "approved-rfc.json");
    const issue = (num, depends_on, owns) => ({
      num,
      title: `Issue ${num}`,
      size: "M",
      depends_on,
      owns,
      acceptance_criteria: [`AC-${num}`],
      approach: `Implement issue ${num}`,
      verification_commands: ["node --test"],
      test_hooks: [`AC-${num}`],
    });
    fs.writeFileSync(
      sidecarPath,
      JSON.stringify({
        schema_version: 3,
        slug: "rfc-route-cli",
        title: "Approved RFC",
        size: "L",
        issues: [issue(1, [], ["scripts/shared.js"]), issue(2, [1], ["scripts/consumer.js"])],
        test_strategy: {
          test_levels: "Unit and integration",
          new_infrastructure: "None",
          regression_surface: "Dev route",
          verification_commands: "node --test",
          open_questions: "None",
        },
      })
    );
    const routed = repo.run([
      "route",
      "--session",
      initialized.session_path,
      "--facts",
      factsPath,
      "--rfc-sidecar",
      sidecarPath,
      "--json",
    ]);
    assert.equal(routed.status, 0, routed.stderr);
    assert.deepEqual(JSON.parse(routed.stdout).task.work_units, [
      {
        id: "rfc-1",
        title: "Issue 1",
        depends_on: [],
        owns: ["scripts/shared.js"],
        contract: {
          acceptance_criteria: ["AC-1"],
          approach: "Implement issue 1",
          verification_commands: ["node --test"],
          test_hooks: ["AC-1"],
        },
        status: "pending",
      },
      {
        id: "rfc-2",
        title: "Issue 2",
        depends_on: ["rfc-1"],
        owns: ["scripts/consumer.js"],
        contract: {
          acceptance_criteria: ["AC-2"],
          approach: "Implement issue 2",
          verification_commands: ["node --test"],
          test_hooks: ["AC-2"],
        },
        status: "pending",
      },
    ]);
    assert.equal(repo.run(["status", "--session", initialized.session_path, "--json"]).status, 0);
    const cold = JSON.parse(fs.readFileSync(initialized.session_path, "utf8"));
    assert.equal(cold.task.reference, "PM-123");
    assert.equal(cold.task.rfc_sidecar.path, sidecarPath);
    assert.match(cold.task.rfc_sidecar.sha256, /^sha256:[0-9a-f]{64}$/);
    assert.deepEqual(cold.task.work_units[1].contract.acceptance_criteria, ["AC-2"]);
    fs.appendFileSync(sidecarPath, "\n");
    const drifted = repo.run(["next", "--session", initialized.session_path]);
    assert.notEqual(drifted.status, 0);
    assert.match(drifted.stderr, /sidecar identity hash drifted/);
    const beforeMutation = fs.readFileSync(initialized.session_path, "utf8");
    const resultPath = path.join(repo.root, "drifted-result.json");
    fs.writeFileSync(
      resultPath,
      JSON.stringify({
        schema_version: 1,
        run_id: cold.run_id,
        phase: "intake",
        attempt: 1,
        status: "passed",
        summary: "Must not persist against drift",
        commit: null,
        files_changed: [],
        evidence: [{ kind: "intake", command: "fixture", exit_code: 0, artifact: null }],
        blocker: null,
        runtime: { provider: "inline", model: "test", reasoning: "high", session_id: null },
      })
    );
    const rejectedMutation = repo.run([
      "record",
      "--session",
      initialized.session_path,
      "--result",
      resultPath,
    ]);
    assert.notEqual(rejectedMutation.status, 0);
    assert.match(rejectedMutation.stderr, /sidecar identity hash drifted/);
    assert.equal(fs.readFileSync(initialized.session_path, "utf8"), beforeMutation);
    const rejectedUnit = repo.run([
      "work-unit",
      "--session",
      initialized.session_path,
      "--id",
      "rfc-1",
      "--status",
      "running",
    ]);
    assert.notEqual(rejectedUnit.status, 0);
    assert.match(rejectedUnit.stderr, /sidecar identity hash drifted/);
    assert.equal(fs.readFileSync(initialized.session_path, "utf8"), beforeMutation);
    const rebound = repo.run([
      "route",
      "--session",
      initialized.session_path,
      "--facts",
      factsPath,
      "--rfc-sidecar",
      sidecarPath,
      "--json",
    ]);
    assert.equal(rebound.status, 0, rebound.stderr);
    const reboundSession = JSON.parse(fs.readFileSync(initialized.session_path, "utf8"));
    assert.notEqual(reboundSession.task.rfc_sidecar.sha256, cold.task.rfc_sidecar.sha256);
    assert.deepEqual(reboundSession.task.work_units[1].contract.acceptance_criteria, ["AC-2"]);
  } finally {
    repo.cleanup();
  }
});

test("route rejects an RFC sidecar belonging to another slug", () => {
  const repo = makeRepo();
  try {
    const initialized = JSON.parse(
      repo.run(["init", "--slug", "expected-rfc", "--source-dir", repo.root, "--json"]).stdout
    );
    const factsPath = path.join(repo.root, "facts-mismatch.json");
    fs.writeFileSync(factsPath, JSON.stringify({ kind: "proposal", size: "M", risk: {} }));
    const sidecarPath = path.join(repo.root, "other-rfc.json");
    fs.writeFileSync(
      sidecarPath,
      JSON.stringify({
        schema_version: 3,
        slug: "other-rfc",
        title: "Other RFC",
        size: "M",
        issues: [
          {
            num: 1,
            title: "Other work",
            size: "M",
            depends_on: [],
            owns: ["README.md"],
            acceptance_criteria: ["Other AC"],
            approach: "Do other work",
            verification_commands: ["node --test"],
            test_hooks: [],
          },
        ],
        test_strategy: {
          test_levels: "Unit",
          new_infrastructure: "None",
          regression_surface: "Other",
          verification_commands: "node --test",
          open_questions: "None",
        },
      })
    );
    const routed = repo.run([
      "route",
      "--session",
      initialized.session_path,
      "--facts",
      factsPath,
      "--rfc-sidecar",
      sidecarPath,
    ]);
    assert.equal(routed.status, 3);
    assert.match(routed.stderr, /slug must equal expected-rfc/);
  } finally {
    repo.cleanup();
  }
});

test("work-unit command owns pending, running, and completed transitions", () => {
  const repo = makeRepo();
  const resultPath = path.join(os.tmpdir(), `pm-work-unit-${process.pid}-${Date.now()}.json`);
  try {
    const initialized = JSON.parse(
      repo.run(["init", "--slug", "work-unit-cli", "--source-dir", repo.root, "--json"]).stdout
    );
    const session = JSON.parse(fs.readFileSync(initialized.session_path, "utf8"));
    session.phase = "implementation";
    session.routing.required_phases = ["implementation", "retro"];
    session.task.work_units = [
      {
        id: "unit-a",
        title: "Unit A",
        depends_on: [],
        owns: ["README.md"],
        status: "pending",
      },
    ];
    fs.writeFileSync(initialized.session_path, JSON.stringify(session));

    const running = repo.run([
      "work-unit",
      "--session",
      initialized.session_path,
      "--id",
      "unit-a",
      "--status",
      "running",
      "--json",
    ]);
    assert.equal(running.status, 0, running.stderr);
    const baseCommit = JSON.parse(running.stdout).work_unit.base_commit;

    fs.appendFileSync(path.join(repo.root, "README.md"), "unit\n");
    execFileSync("git", ["add", "README.md"], { cwd: repo.root });
    execFileSync("git", ["commit", "-m", "unit"], { cwd: repo.root });
    const commit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repo.root,
      encoding: "utf8",
    }).trim();
    fs.writeFileSync(
      resultPath,
      JSON.stringify({
        schema_version: 1,
        work_unit_id: "unit-a",
        status: "completed",
        summary: "Unit complete",
        commit,
        files_changed: 1,
        evidence: [{ kind: "test", command: "node --test", exit_code: 0 }],
        blocker: null,
        runtime: { provider: "inline", model: "test" },
      })
    );
    const completed = repo.run([
      "work-unit",
      "--session",
      initialized.session_path,
      "--id",
      "unit-a",
      "--status",
      "completed",
      "--result",
      resultPath,
      "--base-commit",
      baseCommit,
      "--json",
    ]);
    assert.equal(completed.status, 0, completed.stderr);
    assert.equal(JSON.parse(completed.stdout).work_unit.status, "completed");
  } finally {
    fs.rmSync(resultPath, { force: true });
    repo.cleanup();
  }
});

test("all mutating commands fail closed while a live session lock is held", () => {
  const repo = makeRepo();
  try {
    const initialized = JSON.parse(
      repo.run(["init", "--slug", "locked-cli", "--source-dir", repo.root, "--json"]).stdout
    );
    const lockPath = `${initialized.session_path}.lock`;
    fs.mkdirSync(lockPath);
    fs.writeFileSync(
      path.join(lockPath, "owner.json"),
      JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() })
    );
    const authorized = repo.run([
      "authorize",
      "--session",
      initialized.session_path,
      "--grant",
      "create_pr",
      "--reason",
      "test",
    ]);
    assert.equal(authorized.status, 3);
    assert.match(authorized.stderr, /locked by process/);
    assert.equal(
      JSON.parse(fs.readFileSync(initialized.session_path, "utf8")).authority.create_pr,
      false
    );
    fs.rmSync(lockPath, { recursive: true, force: true });
  } finally {
    repo.cleanup();
  }
});

test("recertify updates existing gate evidence for the current HEAD", () => {
  const repo = makeRepo();
  try {
    const initialized = JSON.parse(
      repo.run(["init", "--slug", "recertify-cli", "--source-dir", repo.root, "--json"]).stdout
    );
    const session = JSON.parse(fs.readFileSync(initialized.session_path, "utf8"));
    session.evidence.implementation = {
      commit: execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: repo.root,
        encoding: "utf8",
      }).trim(),
      records: [{ kind: "test", command: "node --test", exit_code: 0, artifact: null }],
      recorded_at: new Date().toISOString(),
    };
    fs.writeFileSync(initialized.session_path, JSON.stringify(session));
    const evidencePath = path.join(repo.root, "recertification.json");
    fs.writeFileSync(
      evidencePath,
      JSON.stringify({
        implementation: [{ kind: "test", command: "node --test", exit_code: 0, artifact: null }],
      })
    );
    const result = repo.run([
      "recertify",
      "--session",
      initialized.session_path,
      "--phases",
      "implementation",
      "--commit",
      session.evidence.implementation.commit,
      "--evidence",
      evidencePath,
      "--json",
    ]);
    assert.equal(result.status, 0, result.stderr);
    const updated = JSON.parse(fs.readFileSync(initialized.session_path, "utf8"));
    assert.equal(
      updated.evidence.implementation.verified_commit,
      session.evidence.implementation.commit
    );
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
    assert.equal(
      JSON.parse(fs.readFileSync(payload.session_path, "utf8")).phase,
      "implementation",
      "late legacy sessions rebuild current gate evidence before delivery"
    );
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
