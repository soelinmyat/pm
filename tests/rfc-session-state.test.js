"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  PHASES,
  applyContext,
  approveSession,
  createSession,
  grantAuthority,
  migrateLegacyMarkdown,
  nextDecision,
  recordResult,
  validateSession,
} = require("../scripts/lib/rfc-session-schema");

test("RFC session separates technical review from explicit human approval", () => {
  const repo = makeRepo();
  try {
    let session = routedSession(repo);
    session = recordResult(session, passed(session));
    assert.equal(session.phase, "generation");

    const artifact = makeArtifact(repo);
    session = recordResult(
      session,
      passed(session, { artifact, evidence: [evidence("artifact")] })
    );
    assert.equal(session.phase, "review");
    assert.equal(session.artifact.sidecar_hash, artifact.sidecar_hash);

    session = recordResult(
      session,
      passed(session, {
        artifact,
        evidence: [evidence("review")],
        reviewer_verdicts: requiredVerdicts(),
      })
    );
    assert.equal(session.phase, "approval");
    assert.equal(session.status, "awaiting_approval");
    assert.equal(session.review.status, "passed");
    assert.equal(session.approval.status, "pending");

    assert.throws(() => recordResult(session, passed(session)), /explicit approval command/);
    session = approveSession(session, { approvedBy: "product-owner" });
    assert.equal(session.phase, "handoff");
    assert.equal(session.approval.status, "approved");
    assert.equal(session.approval.artifact_hash, session.review.artifact_hash);

    session = recordResult(session, passed(session, { artifact, evidence: [evidence("handoff")] }));
    assert.equal(session.status, "complete");
    assert.deepEqual(validateSession(session), []);
  } finally {
    repo.cleanup();
  }
});

test("review requires every lens to pass against the generated artifact", () => {
  const repo = makeRepo();
  try {
    let session = routedSession(repo);
    session = recordResult(session, passed(session));
    const artifact = makeArtifact(repo);
    session = recordResult(
      session,
      passed(session, { artifact, evidence: [evidence("artifact")] })
    );

    assert.throws(
      () =>
        recordResult(
          session,
          passed(session, {
            artifact,
            evidence: [evidence("review")],
            reviewer_verdicts: requiredVerdicts().slice(0, 2),
          })
        ),
      /missing review lens: maintainability/
    );
    const blocked = requiredVerdicts();
    blocked[0] = { ...blocked[0], verdict: "block", blocking: ["Unsafe boundary"] };
    assert.throws(
      () =>
        recordResult(
          session,
          passed(session, {
            artifact,
            evidence: [evidence("review")],
            reviewer_verdicts: blocked,
          })
        ),
      /blocking reviewer findings/
    );
  } finally {
    repo.cleanup();
  }
});

test("artifact edits after review invalidate approval", () => {
  const repo = makeRepo();
  try {
    let session = routedSession(repo);
    session = recordResult(session, passed(session));
    const artifact = makeArtifact(repo);
    session = recordResult(
      session,
      passed(session, { artifact, evidence: [evidence("artifact")] })
    );
    session = recordResult(
      session,
      passed(session, {
        artifact,
        evidence: [evidence("review")],
        reviewer_verdicts: requiredVerdicts(),
      })
    );

    fs.appendFileSync(artifact.html_path, "<!-- unreviewed architecture change -->\n");
    assert.throws(() => approveSession(session, { approvedBy: "owner" }), /artifact changed/);
  } finally {
    repo.cleanup();
  }
});

test("external effects require narrow, explicit authority grants", () => {
  const repo = makeRepo();
  try {
    const session = createSession({ slug: "authority", sourceDir: repo.root });
    assert.deepEqual(session.authority, {
      linear_create: false,
      loop_approval: false,
      open_browser: false,
      start_implementation: false,
    });
    const updated = grantAuthority(session, {
      action: "linear_create",
      reason: "User asked to create tracking issues",
    });
    assert.equal(updated.authority.linear_create, true);
    assert.match(updated.authority_log[0].reason, /User asked/);
    assert.throws(() => grantAuthority(session, { action: "merge", reason: "no" }), /unknown/);
  } finally {
    repo.cleanup();
  }
});

test("nextDecision returns only the active instruction path and phase contract", () => {
  const repo = makeRepo();
  try {
    const session = createSession({ slug: "phase-local", sourceDir: repo.root });
    const decision = nextDecision(session, "/tmp/session.json");
    assert.equal(decision.phase, "intake");
    assert.equal(decision.instruction_path, "skills/rfc/steps/01-intake.md");
    assert.ok(Array.isArray(decision.required_evidence));
    assert.ok(!JSON.stringify(decision).includes("03-rfc-review"));
    assert.deepEqual(PHASES, ["intake", "generation", "review", "approval", "handoff"]);
  } finally {
    repo.cleanup();
  }
});

test("legacy approved state is retained but never imported as trusted approval", () => {
  const repo = makeRepo();
  try {
    const legacy = path.join(repo.root, ".pm", "rfc-sessions", "legacy.md");
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(
      legacy,
      [
        "# RFC Session State",
        "",
        "| Field | Value |",
        "|---|---|",
        "| Slug | legacy |",
        "| Stage | approved |",
      ].join("\n")
    );
    const session = migrateLegacyMarkdown(legacy);
    assert.equal(session.phase, "intake");
    assert.equal(session.approval.status, "pending");
    assert.equal(session.migration.legacy_stage, "approved");
    assert.equal(session.migration.approval_trusted, false);
    assert.ok(fs.existsSync(legacy));
  } finally {
    repo.cleanup();
  }
});

function routedSession(repo) {
  return applyContext(createSession({ slug: "safe-approval", sourceDir: repo.root }), {
    source_kind: "proposal",
    proposal_path: path.join(repo.root, "proposal.md"),
    size: "M",
    acceptance_criteria: ["AC-1 remains traceable"],
  });
}

function passed(session, overrides = {}) {
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

function evidence(kind) {
  return { kind, command: "node test", exit_code: 0, artifact: null };
}

function requiredVerdicts() {
  return ["architecture-risk", "test-strategy", "maintainability"].map((lens) => ({
    lens,
    verdict: "pass",
    blocking: [],
    advisory: [],
  }));
}

function makeArtifact(repo) {
  const jsonPath = path.join(repo.root, "rfc.json");
  const htmlPath = path.join(repo.root, "rfc.html");
  fs.writeFileSync(
    jsonPath,
    `${JSON.stringify({
      schema_version: 2,
      slug: "safe-approval",
      title: "Safe approval",
      size: "M",
      issues: [
        {
          num: 1,
          title: "Add explicit approval",
          size: "M",
          test_hooks: ["Test levels in scope -> AC-1"],
        },
      ],
      test_strategy: {
        test_levels: "Unit and CLI integration",
        new_infrastructure: "None",
        regression_surface: "RFC session tests",
        verification_commands: "node --test tests/rfc-session-state.test.js",
        open_questions: "None",
      },
    })}\n`
  );
  const hash = `sha256:${crypto.createHash("sha256").update(fs.readFileSync(jsonPath)).digest("hex")}`;
  fs.writeFileSync(htmlPath, `<main data-sidecar-hash="${hash}"></main>\n`);
  const htmlHash = `sha256:${crypto.createHash("sha256").update(fs.readFileSync(htmlPath)).digest("hex")}`;
  execFileSync("git", ["add", "."], { cwd: repo.root });
  execFileSync("git", ["commit", "-qm", "add RFC artifact"], { cwd: repo.root });
  return {
    html_path: htmlPath,
    json_path: jsonPath,
    html_hash: htmlHash,
    sidecar_hash: hash,
    repo_root: repo.root,
    commit: repo.head(),
  };
}

function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-rfc-session-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
  fs.writeFileSync(path.join(root, "proposal.md"), "proposal\n");
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root });
  return {
    root,
    head: () => execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}
