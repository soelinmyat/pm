"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { checkGateManifest } = require("../scripts/dev-gate-check");

const marker = "<!-- mcp-feature-coverage: required -->";

function fixture(t, policy = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-mcp-coverage-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  fs.writeFileSync(path.join(root, "AGENTS.md"), policy ? marker : "# Project instructions");
  git("add", ".");
  git("commit", "-qm", "baseline");
  const commit = git("rev-parse", "HEAD");
  const dir = path.join(root, ".pm/dev-sessions/example");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "verification.log"), "verification passed\n");
  const session = {
    run_id: "dev_example",
    slug: "example",
    source: { worktree: root, base_commit: commit },
    task: { acceptance_criteria: ["List asset servicing records through the assistant."] },
    routing: { review_mode: "code-scan", required_gates: ["verification"] },
  };
  const manifest = {
    schema_version: 1,
    run_id: session.run_id,
    gates: [
      {
        name: "verification",
        status: "passed",
        commit,
        artifact: path.join(dir, "verification.log"),
        reason: "",
        checked_at: new Date().toISOString(),
      },
    ],
  };
  const check = () =>
    checkGateManifest(manifest, {
      artifactRoot: root,
      manifestPath: path.join(dir, "gates.json"),
      currentCommit: commit,
      canonicalSession: session,
      requiredGates: ["verification"],
      authoritativeBaseCommit: commit,
    });
  return { root, dir, git, commit, session, check };
}

test("delivery blocks an opted-in project when MCP coverage is missing", (t) => {
  const f = fixture(t);
  const result = f.check();
  assert.equal(result.ok, false, "MCP coverage must be required before verification passes");
  assert.match(JSON.stringify(result.issues), /MCP coverage/);
});

test("projects without an MCP completion policy retain their existing gates", (t) => {
  assert.equal(fixture(t, false).check().ok, true);
});

function coverage(f, applicable = true) {
  const artifact = ".pm/dev-sessions/example/mcp-evidence/transport.log";
  const bytes = "2 tests passed: discovery and scoped asset detail call\n";
  fs.mkdirSync(path.dirname(path.join(f.root, artifact)), { recursive: true });
  fs.writeFileSync(path.join(f.root, artifact), bytes);
  return {
    schema_version: 1,
    run_id: f.session.run_id,
    commit: f.commit,
    base_commit: f.commit,
    entries: [
      {
        criterion: f.session.task.acceptance_criteria[0],
        status: applicable ? "covered" : "not_applicable",
        rationale: applicable
          ? "The existing list_assets tool returns service dates with account and location scoping."
          : "This change only adjusts developer instructions and adds no external product data or action.",
        tools: applicable ? ["list_assets"] : [],
        check_ids: applicable ? ["transport"] : [],
      },
    ],
    checks: applicable
      ? [
          {
            id: "transport",
            command: "bin/rails test test/integration/mcp/assets_test.rb",
            exit_code: 0,
            artifact,
            sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
          },
        ]
      : [],
  };
}

function save(f, report) {
  fs.writeFileSync(path.join(f.dir, "mcp-coverage.json"), JSON.stringify(report));
}

test("current MCP coverage with retained passing output satisfies verification", (t) => {
  const f = fixture(t);
  save(f, coverage(f));
  assert.equal(f.check().ok, true, JSON.stringify(f.check().issues));
});

test("a specific non-applicability decision needs no artificial tool or test", (t) => {
  const f = fixture(t);
  save(f, coverage(f, false));
  assert.equal(f.check().ok, true);
});

for (const [name, mutate] of Object.entries({
  "stale head": (r) => {
    r.commit = "a".repeat(40);
  },
  "changed base": (r) => {
    r.base_commit = "a".repeat(40);
  },
  "wrong session": (r) => {
    r.run_id = "another_run";
  },
  "missing criterion": (r) => {
    r.entries = [];
  },
  "changed criterion": (r) => {
    r.entries[0].criterion = "Unrelated feature";
  },
  "deferred coverage": (r) => {
    r.entries[0].status = "deferred";
  },
  "empty rationale": (r) => {
    r.entries[0].rationale = "N/A";
  },
  "missing tools": (r) => {
    r.entries[0].tools = [];
  },
  "missing test references": (r) => {
    r.entries[0].check_ids = [];
  },
  "unknown check": (r) => {
    r.entries[0].check_ids = ["unknown"];
  },
  "failing check": (r) => {
    r.checks[0].exit_code = 1;
  },
  "changed output hash": (r) => {
    r.checks[0].sha256 = "a".repeat(64);
  },
  "duplicate check": (r) => {
    r.checks.push(r.checks[0]);
  },
  "foreign output": (r) => {
    r.checks[0].artifact = "AGENTS.md";
  },
  "traversal output": (r) => {
    r.checks[0].artifact = ".pm/dev-sessions/example/mcp-evidence/../../../../AGENTS.md";
  },
  "unrecognized report field": (r) => {
    r.skip = true;
  },
  "contradictory exemption": (r) => {
    r.entries[0].status = "not_applicable";
  },
})) {
  test(`coverage rejects ${name}`, (t) => {
    const f = fixture(t);
    const report = coverage(f);
    mutate(report);
    save(f, report);
    assert.equal(f.check().ok, false);
  });
}

test("removing the marker in a feature branch cannot waive the base policy", (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, "AGENTS.md"), "# Policy removed\n");
  f.git("add", ".");
  f.git("commit", "-qm", "remove policy");
  const { checkMcpCoverage } = require("../scripts/lib/mcp-coverage");
  const result = checkMcpCoverage({
    root: f.root,
    session: f.session,
    commit: f.git("rev-parse", "HEAD"),
    baseCommit: f.commit,
    reportDirectory: f.dir,
  });
  assert.equal(result.required, true);
  assert.equal(result.ok, false);
});

test("symlinked test output cannot substitute external evidence", (t) => {
  const f = fixture(t);
  const report = coverage(f);
  save(f, report);
  const output = path.join(f.root, report.checks[0].artifact);
  fs.unlinkSync(output);
  fs.symlinkSync(path.join(f.root, "AGENTS.md"), output);
  assert.equal(f.check().ok, false);
});

test("coverage supports a canonical session in the originating worktree", (t) => {
  const f = fixture(t);
  const report = coverage(f);
  const source = path.join(f.root, "source");
  f.git("worktree", "add", "-q", "--detach", source);
  f.session.source.repo_root = f.root;
  f.session.source.worktree = source;
  save(f, report);
  assert.equal(f.check().ok, true, JSON.stringify(f.check().issues));
});
