"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const {
  PHASES,
  applyRouting,
  createSession,
  grantAuthority,
  migrateLegacyMarkdown,
  readSession,
  recertifyEvidence,
  recordResult,
  resumeBlocked,
  transitionWorkUnit,
  updateWorkspace,
  validateResult,
  validateSession,
  writeJsonAtomic,
  writeSession,
} = require("../scripts/lib/dev-session-schema");

test("applyRouting persists observed risk and prevents kind from erasing safeguards", () => {
  const repo = makeRepo();
  try {
    const session = createSession({ slug: "risk-route", sourceDir: repo.root });
    const routed = applyRouting(session, {
      kind: "task",
      size: "S",
      risk: { auth: 2, external_contract: 2 },
      acceptance_criteria: ["Unauthorized requests remain denied"],
      work_units: [],
    });
    assert.equal(routed.task.risk.auth, 2);
    assert.equal(routed.task.risk_tier, "high");
    assert.equal(routed.routing.review_mode, "full");
    assert.ok(routed.routing.required_gates.includes("review"));
    assert.deepEqual(validateSession(routed), []);
    assert.equal(session.task.risk_tier, "unassessed", "routing must not mutate its input");
  } finally {
    repo.cleanup();
  }
});

test("applyRouting rejects invalid work-unit dependencies before persisting intake", () => {
  const repo = makeRepo();
  try {
    const session = createSession({ slug: "invalid-dag", sourceDir: repo.root });
    assert.throws(
      () =>
        applyRouting(session, {
          kind: "task",
          size: "S",
          risk: {},
          work_units: [
            { id: "a", title: "A", depends_on: ["missing"], owns: ["a.js"], status: "pending" },
          ],
        }),
      /unknown dependency missing/
    );
  } finally {
    repo.cleanup();
  }
});

test("runner-owned work-unit transitions persist execution state and accepted commits", () => {
  const repo = makeRepo();
  try {
    let session = createSession({ slug: "work-unit-ledger", sourceDir: repo.root });
    session = applyRouting(session, {
      kind: "task",
      size: "S",
      risk: {},
      work_units: [
        {
          id: "unit-a",
          title: "Implement A",
          depends_on: [],
          owns: ["README.md"],
          status: "pending",
        },
      ],
    });
    session.phase = "implementation";
    session.routing.required_phases = ["implementation", "retro"];
    session = transitionWorkUnit(session, { id: "unit-a", status: "running" });
    assert.equal(session.task.work_units[0].status, "running");
    assert.equal(session.task.work_units[0].base_commit, repo.head());

    fs.appendFileSync(path.join(repo.root, "README.md"), "implemented\n");
    execFileSync("git", ["add", "README.md"], { cwd: repo.root });
    execFileSync("git", ["commit", "-m", "implement unit"], { cwd: repo.root });
    session = transitionWorkUnit(session, {
      id: "unit-a",
      status: "completed",
      result: {
        schema_version: 1,
        work_unit_id: "unit-a",
        status: "completed",
        summary: "Implemented A",
        commit: repo.head(),
        files_changed: 1,
        evidence: [{ kind: "test", command: "node --test", exit_code: 0 }],
        blocker: null,
        runtime: { provider: "inline", model: "test" },
      },
    });
    assert.equal(session.task.work_units[0].status, "completed");
    assert.equal(session.task.work_units[0].result.commit, repo.head());
    assert.equal(session.task.work_units[0].transitions.length, 2);
    assert.deepEqual(validateSession(session), []);
    assert.throws(
      () => transitionWorkUnit(session, { id: "unit-a", status: "running" }),
      /invalid work-unit transition/
    );
  } finally {
    repo.cleanup();
  }
});

test("recertified gate evidence remains current after review fixes change HEAD", () => {
  const repo = makeRepo();
  try {
    let session = createSession({ slug: "recertify", sourceDir: repo.root });
    session.routing.required_phases = ["implementation", "retro"];
    session.routing.required_gates = ["tdd"];
    session.phase = "implementation";
    const original = repo.head();
    session = recordResult(
      session,
      passedResult(session, {
        commit: original,
        evidence: [{ kind: "test", command: "node --test", exit_code: 0, artifact: null }],
      })
    );
    fs.appendFileSync(path.join(repo.root, "README.md"), "review fix\n");
    execFileSync("git", ["add", "README.md"], { cwd: repo.root });
    execFileSync("git", ["commit", "-m", "review fix"], { cwd: repo.root });
    const finalHead = repo.head();
    session = recertifyEvidence(session, ["implementation"], finalHead, {
      implementation: [{ kind: "test", command: "node --test", exit_code: 0, artifact: null }],
    });
    assert.equal(session.evidence.implementation.commit, original);
    assert.equal(session.evidence.implementation.verified_commit, finalHead);
    assert.equal(session.evidence.implementation.verification_records[0].kind, "test");
    session = recordResult(session, passedResult(session));
    assert.equal(session.status, "complete");
  } finally {
    repo.cleanup();
  }
});

test("failed gate evidence cannot be advanced or recertified through noop", () => {
  const repo = makeRepo();
  try {
    let session = createSession({ slug: "failed-noop", sourceDir: repo.root });
    session.phase = "implementation";
    session.routing.required_phases = ["implementation", "retro"];
    session.routing.required_gates = ["tdd"];
    session = recordResult(
      session,
      passedResult(session, {
        status: "failed",
        commit: repo.head(),
        evidence: [{ kind: "test", command: "node --test", exit_code: 1, artifact: null }],
      })
    );
    assert.equal(session.evidence.implementation, undefined);
    assert.throws(
      () => recordResult(session, passedResult(session, { status: "noop", attempt: 2 })),
      /cannot use noop/
    );
    assert.throws(
      () => recertifyEvidence(session, ["implementation"], repo.head(), { implementation: [] }),
      /missing evidence/
    );
  } finally {
    repo.cleanup();
  }
});

test("recertification rejects a bare commit or unrelated evidence kind", () => {
  const repo = makeRepo();
  try {
    let session = createSession({ slug: "recertify-proof", sourceDir: repo.root });
    session.phase = "implementation";
    session.routing.required_phases = ["implementation", "retro"];
    session.routing.required_gates = ["tdd"];
    session = recordResult(
      session,
      passedResult(session, {
        commit: repo.head(),
        evidence: [{ kind: "test", command: "node --test", exit_code: 0, artifact: null }],
      })
    );
    assert.throws(
      () => recertifyEvidence(session, ["implementation"], repo.head()),
      /fresh evidence grouped by phase/
    );
    assert.throws(
      () =>
        recertifyEvidence(session, ["implementation"], repo.head(), {
          implementation: [{ kind: "review", command: "review", exit_code: 0, artifact: null }],
        }),
      /original evidence kind/
    );
  } finally {
    repo.cleanup();
  }
});

test("blocked sessions resume only through an audited resolution", () => {
  const repo = makeRepo();
  try {
    let session = createSession({ slug: "unblock", sourceDir: repo.root });
    session = recordResult(
      session,
      passedResult(session, {
        status: "blocked",
        blocker: { code: "auth", reason: "Login required", remediation: "Authenticate" },
      })
    );
    session = resumeBlocked(session, "Authenticated the runtime");
    assert.equal(session.status, "active");
    assert.equal(session.phase_attempt, 1);
    assert.equal(session.blockers[0].resolution, "Authenticated the runtime");
    assert.ok(session.blockers[0].resolved_at);
  } finally {
    repo.cleanup();
  }
});

test("external authority requires an explicit recorded grant", () => {
  const repo = makeRepo();
  try {
    const session = createSession({ slug: "authority", sourceDir: repo.root });
    assert.equal(session.authority.push_feature_branch, false);
    assert.equal(session.authority.create_pr, false);
    const granted = grantAuthority(session, ["merge", "tracker_updates"], "User asked to ship");
    assert.equal(granted.authority.merge, true);
    assert.equal(granted.authority.tracker_updates, true);
    assert.deepEqual(granted.authority_log[0].actions, ["merge", "tracker_updates"]);
    assert.equal(granted.authority_log[0].reason, "User asked to ship");
    assert.ok(Date.parse(granted.authority_log[0].granted_at));
    assert.deepEqual(granted.routing.reasons, session.routing.reasons);
    assert.equal(session.authority.merge, false);
    assert.throws(
      () => grantAuthority(session, ["local_writes"], "expand"),
      /not externally grantable/
    );
  } finally {
    repo.cleanup();
  }
});

test("mandatory routed phases cannot advance through noop", () => {
  const repo = makeRepo();
  try {
    for (const phase of ["intake", "workspace", "readiness"]) {
      const session = createSession({ slug: `no-noop-${phase}`, sourceDir: repo.root });
      session.phase = phase;
      session.routing.required_phases = [phase, "retro"];
      assert.throws(
        () => recordResult(session, passedResult(session, { status: "noop" })),
        /cannot use noop/
      );
    }
  } finally {
    repo.cleanup();
  }
});

test("workspace updates are verified against the same Git repository", () => {
  const repo = makeRepo();
  try {
    const session = createSession({ slug: "workspace", sourceDir: repo.root });
    const worktree = path.join(repo.root, ".worktrees", "feature");
    fs.mkdirSync(path.dirname(worktree), { recursive: true });
    execFileSync("git", ["worktree", "add", "-b", "feature/test", worktree], {
      cwd: repo.root,
    });
    const updated = updateWorkspace(session, worktree);
    assert.equal(updated.source.worktree, fs.realpathSync(worktree));
    assert.equal(updated.source.branch, "feature/test");
  } finally {
    repo.cleanup();
  }
});

function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-dev-session-state-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: root });
  fs.writeFileSync(path.join(root, "README.md"), "fixture\n");
  execFileSync("git", ["add", "README.md"], { cwd: root });
  execFileSync("git", ["commit", "-m", "fixture"], { cwd: root });
  return {
    root,
    head() {
      return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    },
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function passedResult(session, overrides = {}) {
  const defaultEvidenceKind = {
    intake: "intake",
    workspace: "workspace",
    readiness: "rfc-readiness",
    implementation: "test",
    "design-critique": "review",
    qa: "test",
    review: "review",
    ship: "delivery",
    retro: "retro",
  }[session.phase];
  return {
    schema_version: 1,
    run_id: session.run_id,
    phase: session.phase,
    attempt: session.phase_attempt,
    status: "passed",
    summary: `Completed ${session.phase}`,
    commit: null,
    files_changed: [],
    evidence: defaultEvidenceKind
      ? [{ kind: defaultEvidenceKind, command: "fixture", exit_code: 0, artifact: null }]
      : [],
    blocker: null,
    runtime: {
      provider: "inline",
      model: "test",
      reasoning: "high",
      session_id: null,
    },
    ...overrides,
  };
}

test("createSession produces a strict, cold-resumable v2 state", () => {
  const repo = makeRepo();
  try {
    const session = createSession({ slug: "state-harness", sourceDir: repo.root });
    assert.equal(session.schema_version, 2);
    assert.match(session.run_id, /^dev_/);
    assert.equal(session.phase, "intake");
    assert.equal(session.phase_attempt, 1);
    assert.deepEqual(session.routing.required_phases, PHASES);
    assert.equal(session.source.repo_root, fs.realpathSync(repo.root));
    assert.equal(session.source.branch, "main");
    assert.equal(session.source.base_commit, repo.head());
    assert.deepEqual(validateSession(session), []);
  } finally {
    repo.cleanup();
  }
});

test("the published JSON Schema exposes session and phase-result contracts", () => {
  const schemaPath = path.resolve(
    __dirname,
    "..",
    "skills",
    "dev",
    "references",
    "dev-session.schema.json"
  );
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  assert.equal(schema.properties.schema_version.const, 2);
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.$defs.phase_result.properties.schema_version.const, 1);
  assert.equal(schema.$defs.phase_result.additionalProperties, false);
});

test("validateSession rejects unknown top-level fields and invalid paths", () => {
  const repo = makeRepo();
  try {
    const session = createSession({ slug: "strict", sourceDir: repo.root });
    session.typo_field = true;
    session.source.repo_root = "relative/path";
    const errors = validateSession(session);
    assert.ok(errors.some((error) => error.path === "$.typo_field"));
    assert.ok(errors.some((error) => error.path === "$.source.repo_root"));
  } finally {
    repo.cleanup();
  }
});

test("atomic session writes use mode 0600 and leave no temp files", () => {
  const repo = makeRepo();
  try {
    const session = createSession({ slug: "atomic", sourceDir: repo.root });
    const sessionPath = path.join(repo.root, ".pm", "dev-sessions", "atomic", "session.json");
    writeSession(sessionPath, session);
    assert.equal(fs.statSync(sessionPath).mode & 0o777, 0o600);
    assert.deepEqual(readSession(sessionPath), session);
    assert.deepEqual(
      fs.readdirSync(path.dirname(sessionPath)).filter((name) => name.includes(".tmp-")),
      []
    );

    const otherPath = path.join(path.dirname(sessionPath), "result.json");
    writeJsonAtomic(otherPath, { ok: true });
    assert.equal(fs.statSync(otherPath).mode & 0o777, 0o600);
  } finally {
    repo.cleanup();
  }
});

test("a mismatched or evidence-free required result cannot advance", () => {
  const repo = makeRepo();
  try {
    const session = createSession({ slug: "result-guard", sourceDir: repo.root });
    const mismatch = passedResult(session, { run_id: "dev_wrong" });
    assert.ok(validateResult(session, mismatch).some((error) => /run_id/.test(error.message)));

    session.phase = "implementation";
    const noEvidence = passedResult(session, { commit: repo.head(), evidence: [] });
    assert.ok(validateResult(session, noEvidence).some((error) => /evidence/.test(error.message)));
    assert.throws(() => recordResult(session, noEvidence), /result is invalid/);
    assert.equal(session.phase, "implementation");
  } finally {
    repo.cleanup();
  }
});

test("late-phase legacy migration routes back through implementation for fresh gates", () => {
  const repo = makeRepo();
  try {
    const legacyPath = path.join(repo.root, ".dev-state-late.md");
    fs.writeFileSync(
      legacyPath,
      `# Legacy\n\n| Field | Value |\n|---|---|\n| Stage | ship |\n| Repo root | ${repo.root} |\n`
    );
    const { session } = migrateLegacyMarkdown(legacyPath);
    assert.equal(session.phase, "implementation");
    assert.match(session.routing.reasons[0], /rebuild current gate evidence/);
  } finally {
    repo.cleanup();
  }
});

test("recordResult advances deterministically and records a result hash", () => {
  const repo = makeRepo();
  try {
    const session = createSession({ slug: "transition", sourceDir: repo.root });
    const next = recordResult(session, passedResult(session));
    assert.equal(next.phase, "workspace");
    assert.equal(next.phase_attempt, 1);
    assert.equal(next.history.length, 1);
    assert.equal(next.history[0].prior_phase, "intake");
    assert.equal(next.history[0].next_phase, "workspace");
    assert.match(next.history[0].result_hash, /^sha256:[a-f0-9]{64}$/);
    assert.equal(session.phase, "intake", "recordResult must not mutate its input");
  } finally {
    repo.cleanup();
  }
});

test("runtime session IDs are optional in provider-neutral results", () => {
  const repo = makeRepo();
  try {
    const session = createSession({ slug: "optional-runtime-id", sourceDir: repo.root });
    const result = passedResult(session);
    delete result.runtime.session_id;
    assert.deepEqual(validateResult(session, result), []);
  } finally {
    repo.cleanup();
  }
});

test("recordResult persists provider session identity for cold resume", () => {
  const repo = makeRepo();
  try {
    const session = createSession({ slug: "runtime-resume", sourceDir: repo.root });
    const updated = recordResult(
      session,
      passedResult(session, {
        runtime: {
          provider: "codex",
          model: "gpt-5.6-sol",
          reasoning: "high",
          session_id: "thread-42",
        },
      })
    );
    assert.equal(updated.execution.runtime_session_id, "thread-42");
    assert.equal(updated.execution.runtime, "codex");
    assert.equal(updated.execution.model, "gpt-5.6-sol");
  } finally {
    repo.cleanup();
  }
});

test("completion requires current final-gate evidence", () => {
  const repo = makeRepo();
  try {
    let session = createSession({ slug: "complete", sourceDir: repo.root });
    session.phase = "implementation";
    session.routing.required_phases = ["implementation", "retro"];
    session.routing.required_gates = ["tdd"];
    session = recordResult(
      session,
      passedResult(session, {
        commit: repo.head(),
        evidence: [{ kind: "test", command: "node --test", exit_code: 0, artifact: null }],
      })
    );
    session = recordResult(session, passedResult(session));
    assert.equal(session.status, "complete");
    assert.equal(session.history.at(-1).reason, "all routed phases and final gates completed");
  } finally {
    repo.cleanup();
  }
});

test("failed results consume a bounded retry and blockers do not advance", () => {
  const repo = makeRepo();
  try {
    let session = createSession({ slug: "retry", sourceDir: repo.root });
    const failed = passedResult(session, { status: "failed", summary: "Baseline failed" });
    session = recordResult(session, failed);
    assert.equal(session.phase, "intake");
    assert.equal(session.phase_attempt, 2);
    assert.equal(session.status, "active");

    const blocked = passedResult(session, {
      status: "blocked",
      attempt: 2,
      summary: "Need a decision",
      blocker: {
        code: "product-decision",
        reason: "Choose compatibility behavior",
        remediation: "Ask owner",
      },
    });
    session = recordResult(session, blocked);
    assert.equal(session.phase, "intake");
    assert.equal(session.status, "blocked");
    assert.equal(session.blockers.length, 1);
  } finally {
    repo.cleanup();
  }
});

test("commit-bearing evidence must match the current reachable branch head", () => {
  const repo = makeRepo();
  try {
    const session = createSession({ slug: "stale", sourceDir: repo.root });
    session.phase = "implementation";
    const stale = repo.head();
    fs.appendFileSync(path.join(repo.root, "README.md"), "later\n");
    execFileSync("git", ["add", "README.md"], { cwd: repo.root });
    execFileSync("git", ["commit", "-m", "later"], { cwd: repo.root });

    const result = passedResult(session, {
      commit: stale,
      files_changed: ["README.md"],
      evidence: [{ kind: "test", command: "node --test", exit_code: 0, artifact: null }],
    });
    const errors = validateResult(session, result);
    assert.ok(errors.some((error) => /stale/.test(error.message)));
  } finally {
    repo.cleanup();
  }
});

test("commit evidence rejects an assigned worktree switched to another branch", () => {
  const repo = makeRepo();
  try {
    const session = createSession({ slug: "branch-drift", sourceDir: repo.root });
    session.phase = "implementation";
    execFileSync("git", ["switch", "-c", "other"], { cwd: repo.root });
    const result = passedResult(session, {
      commit: repo.head(),
      evidence: [{ kind: "test", command: "node --test", exit_code: 0, artifact: null }],
    });
    const errors = validateResult(session, result);
    assert.ok(errors.some((error) => /reachable|branch drift/.test(error.message)));
  } finally {
    repo.cleanup();
  }
});

test("legacy Markdown migrates without deleting its source", () => {
  const repo = makeRepo();
  try {
    const legacyPath = path.join(repo.root, ".dev-state-legacy-feature.md");
    fs.writeFileSync(
      legacyPath,
      [
        "# Dev Session State",
        "",
        "| Field | Value |",
        "|---|---|",
        "| Run ID | old-run-7 |",
        "| Stage | implement |",
        "| Size | L |",
        "| Repo root | " + repo.root + " |",
        "| Branch | main |",
        "| Started at | 2026-07-10T00:00:00.000Z |",
        "",
      ].join("\n")
    );
    const { session, outputPath } = migrateLegacyMarkdown(legacyPath);
    assert.equal(session.phase, "implementation");
    assert.equal(session.task.size, "L");
    assert.equal(session.migration.legacy_path, legacyPath);
    assert.ok(fs.existsSync(legacyPath), "migration must retain the legacy source");
    assert.equal(
      outputPath,
      path.join(repo.root, ".pm", "dev-sessions", "legacy-feature", "session.json")
    );
    assert.deepEqual(validateSession(session), []);
  } finally {
    repo.cleanup();
  }
});
