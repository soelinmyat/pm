"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
let Ajv2020;
let addFormats;
try {
  Ajv2020 = require("ajv/dist/2020");
  addFormats = require("ajv-formats");
} catch (error) {
  if (error.code !== "MODULE_NOT_FOUND") throw error;
}

const {
  PHASES,
  applyContext,
  artifactFingerprint,
  approveSession,
  buildApprovalAudit,
  createSession,
  grantAuthority,
  migrateLegacyMarkdown,
  nextDecision,
  recordResult,
  resumeBlocked,
  reviseSession,
  validateSession,
  verifyArtifact,
} = require("../scripts/lib/rfc-session-schema");
const {
  createSession: createDevSession,
  validateResult: validateDevResult,
} = require("../scripts/lib/dev-session-schema");
const {
  buildApproval: buildProposalApproval,
  proposalContentHash,
} = require("../scripts/lib/proposal-schema");

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
        reviewer_verdicts: requiredVerdicts(artifactFingerprint(artifact)),
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
    assert.deepEqual(
      approveSession(session, { approvedBy: "product-owner" }),
      session,
      "retrying the same approval is idempotent"
    );

    let approvedArtifact = updateArtifactHtml(repo, artifact, approveArtifactHtml);
    const approvalPath = approvedArtifact.json_path.replace(/\.json$/i, ".approval.json");
    const approvalAudit = buildApprovalAudit(session, approvedArtifact);
    if (Ajv2020) {
      const approvalSchema = JSON.parse(
        fs.readFileSync(
          path.join(__dirname, "..", "skills", "rfc", "references", "rfc-approval.schema.json"),
          "utf8"
        )
      );
      const ajv = new Ajv2020({ allErrors: true, strict: true });
      addFormats(ajv);
      assert.equal(ajv.compile(approvalSchema)(approvalAudit), true);
    }
    fs.writeFileSync(approvalPath, `${JSON.stringify(approvalAudit, null, 2)}\n`);
    execFileSync("git", ["add", path.relative(repo.root, approvalPath)], { cwd: repo.root });
    execFileSync("git", ["commit", "-qm", "add approval audit"], { cwd: repo.root });
    approvedArtifact = { ...approvedArtifact, commit: repo.head() };
    session = recordResult(
      session,
      passed(session, {
        artifact: approvedArtifact,
        evidence: [
          evidence("handoff"),
          evidence("lifecycle"),
          evidence("approval-audit", approvalPath),
        ],
      })
    );
    assert.equal(session.status, "complete");
    const archivePath = path.join(
      repo.root,
      ".pm",
      "rfc-sessions",
      "completed",
      session.slug,
      session.run_id,
      "session.json"
    );
    fs.mkdirSync(path.dirname(archivePath), { recursive: true });
    fs.writeFileSync(archivePath, `${JSON.stringify(session, null, 2)}\n`);
    const devSession = createDevSession({ slug: session.slug, sourceDir: repo.root });
    devSession.phase = "readiness";
    devSession.routing.required_phases = ["readiness", "implementation", "retro"];
    const devReadiness = {
      schema_version: 1,
      run_id: devSession.run_id,
      phase: "readiness",
      attempt: 1,
      status: "passed",
      summary: "RFC is approved for exact artifacts",
      commit: repo.head(),
      files_changed: [],
      evidence: [
        {
          kind: "rfc-readiness",
          command: "rfc-sidecar-check",
          exit_code: 0,
          artifact: approvedArtifact.json_path,
        },
      ],
      blocker: null,
      runtime: { provider: "inline", model: "test", reasoning: "high", session_id: null },
    };
    assert.deepEqual(validateDevResult(devSession, devReadiness), []);
    fs.writeFileSync(
      approvalPath,
      `${JSON.stringify({ ...approvalAudit, approved_by: "forged-owner" }, null, 2)}\n`
    );
    assert.ok(
      validateDevResult(devSession, devReadiness).some((entry) =>
        /completed RFC run/.test(entry.message)
      )
    );
    const substitutedSidecar = JSON.parse(fs.readFileSync(approvedArtifact.json_path, "utf8"));
    substitutedSidecar.title = "Substituted unapproved design";
    const substitutedSidecarBytes = Buffer.from(`${JSON.stringify(substitutedSidecar)}\n`);
    fs.writeFileSync(approvedArtifact.json_path, substitutedSidecarBytes);
    const substitutedSidecarHash = `sha256:${crypto
      .createHash("sha256")
      .update(substitutedSidecarBytes)
      .digest("hex")}`;
    const substitutedHtml = fs
      .readFileSync(approvedArtifact.html_path, "utf8")
      .replace(approvedArtifact.sidecar_hash, substitutedSidecarHash);
    fs.writeFileSync(approvedArtifact.html_path, substitutedHtml);
    fs.writeFileSync(
      approvalPath,
      `${JSON.stringify(
        {
          ...approvalAudit,
          html_sha256: `sha256:${crypto.createHash("sha256").update(substitutedHtml).digest("hex")}`,
          sidecar_sha256: substitutedSidecarHash,
        },
        null,
        2
      )}\n`
    );
    assert.ok(
      validateDevResult(devSession, devReadiness).some((entry) =>
        /completed RFC run/.test(entry.message)
      )
    );
    assert.deepEqual(validateSession(session), []);
  } finally {
    repo.cleanup();
  }
});

test("Dev readiness resolves RFC state and artifacts across separate repositories", () => {
  const source = makeRepo();
  const artifactRepo = makeRepo();
  try {
    let session = applyContext(createSession({ slug: "safe-approval", sourceDir: source.root }), {
      source_kind: "proposal",
      proposal_path: path.join(source.root, "proposal.md"),
      size: "M",
      acceptance_criteria: ["Separate repository approval remains verifiable"],
      artifact_repo_root: artifactRepo.root,
    });
    session = recordResult(session, passed(session));
    let artifact = makeArtifact(artifactRepo);
    session = recordResult(
      session,
      passed(session, { artifact, evidence: [evidence("artifact")] })
    );
    session = recordResult(
      session,
      passed(session, {
        artifact,
        evidence: [evidence("review")],
        reviewer_verdicts: requiredVerdicts(artifactFingerprint(artifact)),
      })
    );
    session = approveSession(session, { approvedBy: "product-owner" });
    artifact = updateArtifactHtml(artifactRepo, artifact, approveArtifactHtml);
    const approvalPath = artifact.json_path.replace(/\.json$/i, ".approval.json");
    fs.writeFileSync(
      approvalPath,
      `${JSON.stringify(buildApprovalAudit(session, artifact), null, 2)}\n`
    );
    execFileSync("git", ["add", path.relative(artifactRepo.root, approvalPath)], {
      cwd: artifactRepo.root,
    });
    execFileSync("git", ["commit", "-qm", "add separate-repo approval audit"], {
      cwd: artifactRepo.root,
    });
    artifact = { ...artifact, commit: artifactRepo.head() };
    session = recordResult(
      session,
      passed(session, {
        artifact,
        evidence: [
          evidence("handoff"),
          evidence("lifecycle"),
          evidence("approval-audit", approvalPath),
        ],
      })
    );
    const archivePath = path.join(
      source.root,
      ".pm",
      "rfc-sessions",
      "completed",
      session.slug,
      session.run_id,
      "session.json"
    );
    fs.mkdirSync(path.dirname(archivePath), { recursive: true });
    fs.writeFileSync(archivePath, `${JSON.stringify(session, null, 2)}\n`);

    const devSession = createDevSession({ slug: session.slug, sourceDir: source.root });
    devSession.phase = "readiness";
    devSession.routing.required_phases = ["readiness", "implementation", "retro"];
    assert.deepEqual(
      validateDevResult(devSession, {
        schema_version: 1,
        run_id: devSession.run_id,
        phase: "readiness",
        attempt: 1,
        status: "passed",
        summary: "Separate-repo RFC is approved",
        commit: source.head(),
        files_changed: [],
        evidence: [
          {
            kind: "rfc-readiness",
            command: "rfc-sidecar-check",
            exit_code: 0,
            artifact: artifact.json_path,
          },
        ],
        blocker: null,
        runtime: { provider: "inline", model: "test", reasoning: "high", session_id: null },
      }),
      []
    );
  } finally {
    source.cleanup();
    artifactRepo.cleanup();
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
            reviewer_verdicts: requiredVerdicts(artifactFingerprint(artifact)).slice(0, 2),
          })
        ),
      /missing review lens: maintainability/
    );
    const blocked = requiredVerdicts(artifactFingerprint(artifact));
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
    assert.throws(
      () =>
        recordResult(
          session,
          passed(session, {
            artifact,
            evidence: [evidence("review")],
            reviewer_verdicts: requiredVerdicts("sha256:" + "0".repeat(64)),
          })
        ),
      /stale or bound to a different artifact/
    );
  } finally {
    repo.cleanup();
  }
});

test("noop cannot bypass approval or handoff evidence", () => {
  const repo = makeRepo();
  try {
    const session = routedSession(repo);
    assert.throws(
      () => recordResult(session, passed(session, { status: "noop" })),
      /cannot be recorded as noop/
    );
  } finally {
    repo.cleanup();
  }
});

test("requested changes and resolved blockers have audited resume transitions", () => {
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
        reviewer_verdicts: requiredVerdicts(artifactFingerprint(artifact)),
      })
    );
    session = reviseSession(session, { reason: "Clarify rollback ownership" });
    assert.equal(session.phase, "review");
    assert.equal(session.status, "active");
    assert.equal(session.review.status, "not_started");
    assert.match(session.history.at(-1).reason, /Clarify rollback ownership/);

    session = recordResult(
      session,
      passed(session, {
        status: "blocked",
        blocker: { code: "auth", reason: "Reviewer unavailable", remediation: "Restore auth" },
      })
    );
    assert.equal(session.status, "blocked");
    session = resumeBlocked(session, { resolution: "Reviewer authentication restored" });
    assert.equal(session.status, "active");
    assert.equal(session.phase, "review");
    assert.equal(session.blockers.at(-1).resolution, "Reviewer authentication restored");
  } finally {
    repo.cleanup();
  }
});

test("artifact verification rejects working bytes not tracked by the declared commit", () => {
  const repo = makeRepo();
  try {
    const artifact = makeArtifact(repo);
    fs.appendFileSync(artifact.html_path, "<!-- uncommitted -->\n");
    artifact.html_hash = `sha256:${crypto
      .createHash("sha256")
      .update(fs.readFileSync(artifact.html_path))
      .digest("hex")}`;
    assert.throws(
      () => verifyArtifact(artifact, { expectedSlug: "safe-approval" }),
      /working bytes do not match the declared commit/
    );
  } finally {
    repo.cleanup();
  }
});

test("artifact verification rejects structurally incomplete RFC HTML", () => {
  const repo = makeRepo();
  try {
    let artifact = makeArtifact(repo);
    artifact = updateArtifactHtml(repo, artifact, (html) =>
      html.replace('<section id="brief"></section>\n', "")
    );
    assert.throws(
      () => verifyArtifact(artifact, { expectedSlug: "safe-approval" }),
      /missing required anchor: brief/
    );
  } finally {
    repo.cleanup();
  }
});

test("phase mutations reject a changed source branch", () => {
  const repo = makeRepo();
  try {
    const session = createSession({ slug: "branch-drift", sourceDir: repo.root });
    execFileSync("git", ["switch", "-q", "-c", "other"], { cwd: repo.root });
    assert.throws(
      () =>
        applyContext(session, {
          source_kind: "proposal",
          proposal_path: path.join(repo.root, "proposal.md"),
          size: "M",
          acceptance_criteria: ["AC"],
        }),
      /source branch changed/
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
        reviewer_verdicts: requiredVerdicts(artifactFingerprint(artifact)),
      })
    );

    fs.appendFileSync(artifact.html_path, "<!-- unreviewed architecture change -->\n");
    assert.throws(() => approveSession(session, { approvedBy: "owner" }), /artifact changed/);
  } finally {
    repo.cleanup();
  }
});

test("handoff rejects substantive HTML changes disguised as lifecycle evidence", () => {
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
        reviewer_verdicts: requiredVerdicts(artifactFingerprint(artifact)),
      })
    );
    session = approveSession(session, { approvedBy: "owner" });
    const changed = updateArtifactHtml(repo, artifact, (html) =>
      approveArtifactHtml(html).replace(
        '<section id="brief"></section>',
        '<section id="brief">Different design</section>'
      )
    );
    assert.throws(
      () =>
        recordResult(
          session,
          passed(session, {
            artifact: changed,
            evidence: [evidence("handoff"), evidence("lifecycle")],
          })
        ),
      /changed substantive HTML/
    );
  } finally {
    repo.cleanup();
  }
});

test("handoff normalizes only the dedicated lifecycle marker", () => {
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
        reviewer_verdicts: requiredVerdicts(artifactFingerprint(artifact)),
      })
    );
    session = approveSession(session, { approvedBy: "owner" });
    const changed = updateArtifactHtml(repo, artifact, (html) =>
      approveArtifactHtml(html).replace(
        '<code>{"status":"draft"}</code>',
        '<code>{"status":"approved"}</code>'
      )
    );
    assert.throws(
      () =>
        recordResult(
          session,
          passed(session, {
            artifact: changed,
            evidence: [evidence("handoff"), evidence("lifecycle")],
          })
        ),
      /changed substantive HTML/
    );
  } finally {
    repo.cleanup();
  }
});

test("handoff rejects contradictory shared and workflow lifecycle metadata", () => {
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
        reviewer_verdicts: requiredVerdicts(artifactFingerprint(artifact)),
      })
    );
    session = approveSession(session, { approvedBy: "owner" });
    const changed = updateArtifactHtml(repo, artifact, (html) =>
      html.replace('{"status":"draft"}', '{"status":"approved"}')
    );
    assert.throws(
      () =>
        recordResult(
          session,
          passed(session, {
            artifact: changed,
            evidence: [evidence("handoff"), evidence("lifecycle")],
          })
        ),
      /workflow lifecycle contradicts PM artifact metadata/
    );
  } finally {
    repo.cleanup();
  }
});

test("headless RFC sessions cannot cross the human approval boundary", () => {
  const repo = makeRepo();
  try {
    let session = routedSession(repo, { headless: true });
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
        reviewer_verdicts: requiredVerdicts(artifactFingerprint(artifact)),
      })
    );
    assert.throws(
      () => approveSession(session, { approvedBy: "unattended-worker" }),
      /headless RFC sessions cannot record human approval/
    );
  } finally {
    repo.cleanup();
  }
});

test("generation rejects an artifact repository not bound during intake", () => {
  const source = makeRepo();
  const foreign = makeRepo();
  try {
    let session = routedSession(source);
    session = recordResult(session, passed(session));
    const artifact = makeArtifact(foreign);
    assert.throws(
      () => recordResult(session, passed(session, { artifact, evidence: [evidence("artifact")] })),
      /intake-bound artifact repository/
    );
  } finally {
    source.cleanup();
    foreign.cleanup();
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

test("intake rejects untraceable sources and non-string acceptance criteria", () => {
  const repo = makeRepo();
  try {
    const session = createSession({ slug: "bad-context", sourceDir: repo.root });
    assert.throws(
      () =>
        applyContext(session, {
          source_kind: "proposal",
          proposal_path: path.join(repo.root, "missing.md"),
          size: "M",
          acceptance_criteria: ["AC"],
        }),
      /does not exist/
    );
    assert.throws(
      () =>
        applyContext(session, {
          source_kind: "linear-issue",
          size: "M",
          acceptance_criteria: [null],
        }),
      /acceptance criterion/
    );
    assert.throws(
      () =>
        applyContext(session, {
          source_kind: "linear-issue",
          size: "M",
          acceptance_criteria: ["AC"],
        }),
      /requires linear_id/
    );
  } finally {
    repo.cleanup();
  }
});

test("intake derives RFC scope from trusted canonical proposal and rejects stale or contradictory input", () => {
  const repo = makeRepo();
  try {
    const proposal = JSON.parse(
      fs.readFileSync(path.join(__dirname, "fixtures", "proposals", "strong-v1.json"), "utf8")
    );
    proposal.lifecycle = "approved";
    proposal.review = {
      status: "passed",
      revision: proposal.revision,
      content_sha256: proposalContentHash(proposal),
      completed_at: "2026-07-14T02:00:00.000Z",
    };
    const proposalPath = path.join(
      repo.root,
      "pm",
      "backlog",
      "proposals",
      `${proposal.slug}.json`
    );
    const approvalPath = proposalPath.replace(/\.json$/, ".approval.json");
    fs.mkdirSync(path.dirname(proposalPath), { recursive: true });
    fs.writeFileSync(proposalPath, `${JSON.stringify(proposal, null, 2)}\n`);
    const approvedProposalBytes = fs.readFileSync(proposalPath);
    const approval = buildProposalApproval(proposal, fs.readFileSync(proposalPath), {
      approvedBy: "user:owner",
      approvedAt: "2026-07-14T03:00:00.000Z",
      decisionId: "groom-approval:groom_test",
      decisionSha256: `sha256:${"5".repeat(64)}`,
    });
    fs.writeFileSync(approvalPath, `${JSON.stringify(approval, null, 2)}\n`);

    const configured = applyContext(createSession({ slug: proposal.slug, sourceDir: repo.root }), {
      source_kind: "proposal",
      proposal_path: proposalPath,
    });
    assert.equal(configured.context.size, "L");
    assert.deepEqual(configured.context.acceptance_criteria, [
      "ac:approval: Given a reviewed proposal, when a user explicitly approves it, then the audit binds its exact bytes, content hash, revision, and approver",
    ]);
    assert.equal(configured.context.proposal_identity.trusted_approval, true);
    assert.equal(configured.context.proposal_identity.decision_id, "groom-approval:groom_test");

    assert.throws(
      () =>
        applyContext(createSession({ slug: "contradiction", sourceDir: repo.root }), {
          source_kind: "proposal",
          proposal_path: proposalPath,
          size: "M",
        }),
      /contradicts canonical proposal size/
    );
    proposal.requirements[0].statement += " Drifted after RFC intake.";
    fs.writeFileSync(proposalPath, `${JSON.stringify(proposal, null, 2)}\n`);
    assert.throws(() => nextDecision(configured, "/tmp/session.json"), /no longer trusted/);
    fs.writeFileSync(proposalPath, approvedProposalBytes);
    fs.unlinkSync(approvalPath);
    assert.throws(
      () =>
        applyContext(createSession({ slug: "missing-audit", sourceDir: repo.root }), {
          source_kind: "proposal",
          proposal_path: proposalPath,
        }),
      /ENOENT/
    );
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

test("session validation rejects unknown fields and missing nested contracts", () => {
  const repo = makeRepo();
  try {
    const session = createSession({ slug: "strict-state", sourceDir: repo.root });
    const unknown = structuredClone(session);
    unknown.surprise = true;
    assert.ok(validateSession(unknown).some((item) => /unknown field/.test(item.message)));
    const missing = structuredClone(session);
    delete missing.execution.mode;
    assert.ok(validateSession(missing).some((item) => item.path === "$.execution.mode"));
  } finally {
    repo.cleanup();
  }
});

test("phase results reject blank runtime session identifiers", () => {
  const repo = makeRepo();
  try {
    const session = routedSession(repo);
    for (const sessionId of ["", "   "]) {
      assert.throws(
        () =>
          recordResult(
            session,
            passed(session, {
              runtime: {
                provider: "inline",
                model: "test",
                reasoning: "high",
                session_id: sessionId,
              },
            })
          ),
        /runtime\.session_id must be null or string/
      );
    }
    assert.doesNotThrow(() =>
      recordResult(
        session,
        passed(session, {
          runtime: {
            provider: "inline",
            model: "test",
            reasoning: "high",
            session_id: "rfc-run-123",
          },
        })
      )
    );
  } finally {
    repo.cleanup();
  }
});

test("phase results reject whitespace-only runtime identity and evidence kinds", () => {
  const repo = makeRepo();
  try {
    const session = routedSession(repo);
    for (const field of ["provider", "model", "reasoning"]) {
      assert.throws(
        () =>
          recordResult(
            session,
            passed(session, {
              runtime: {
                provider: "inline",
                model: "test",
                reasoning: "high",
                session_id: null,
                [field]: "   ",
              },
            })
          ),
        field === "provider"
          ? /phase result runtime is required/
          : new RegExp(`runtime\\.${field} is required`)
      );
    }
    assert.throws(
      () =>
        recordResult(
          session,
          passed(session, {
            evidence: [{ kind: "   ", command: "fixture", exit_code: 0, artifact: null }],
          })
        ),
      /evidence requires kind and integer exit_code/
    );
  } finally {
    repo.cleanup();
  }
});

test(
  "published RFC session schema and runtime reject malformed nested audit records",
  { skip: !Ajv2020 && "Ajv 2020 dev dependency is not installed in this snapshot" },
  () => {
    const repo = makeRepo();
    try {
      const schema = JSON.parse(
        fs.readFileSync(
          path.join(__dirname, "..", "skills", "rfc", "references", "rfc-session.schema.json"),
          "utf8"
        )
      );
      const ajv = new Ajv2020({ allErrors: true });
      addFormats(ajv);
      const validatePublished = ajv.compile(schema);
      const session = createSession({ slug: "schema-parity", sourceDir: repo.root });
      session.attempts = [
        {
          phase: "bogus",
          attempt: 0,
          status: "wat",
          summary: "",
          artifact_hash: "bad",
          recorded_at: "tomorrow",
          runtime: { provider: "", model: 3, reasoning: null, session_id: 4 },
          result_hash: "bad",
        },
      ];
      session.authority_log = [
        { action: "merge", granted: "yes", reason: "", recorded_at: "soon" },
      ];
      session.blockers = [{ code: "bad", reason: "bad", remediation: "fix", unexpected: true }];
      assert.equal(validatePublished(session), false);
      assert.ok(validateSession(session).length > 0);
    } finally {
      repo.cleanup();
    }
  }
);

test(
  "published RFC schema and runtime agree on lifecycle acceptance boundaries",
  { skip: !Ajv2020 && "Ajv 2020 dev dependency is not installed in this snapshot" },
  () => {
    const repo = makeRepo();
    try {
      const schema = JSON.parse(
        fs.readFileSync(
          path.join(__dirname, "..", "skills", "rfc", "references", "rfc-session.schema.json"),
          "utf8"
        )
      );
      const ajv = new Ajv2020({ allErrors: true, strict: true });
      addFormats(ajv);
      const validatePublished = ajv.compile(schema);
      const base = createSession({ slug: "lifecycle-parity", sourceDir: repo.root });
      const fixtures = [
        ["initial", base, true],
        [
          "complete intake with pending approval",
          { ...structuredClone(base), status: "complete", phase: "intake" },
          false,
        ],
        [
          "passed review without proof",
          {
            ...structuredClone(base),
            review: {
              status: "passed",
              artifact_hash: null,
              rounds: 0,
              verdicts: [],
              reviewed_at: null,
            },
          },
          false,
        ],
        [
          "approved without identity",
          {
            ...structuredClone(base),
            approval: {
              status: "approved",
              approved_by: null,
              approved_at: null,
              artifact_hash: null,
            },
          },
          false,
        ],
      ];
      for (const [name, session, expected] of fixtures) {
        assert.equal(validatePublished(session), expected, `${name}: published schema`);
        assert.equal(validateSession(session).length === 0, expected, `${name}: runtime`);
      }
    } finally {
      repo.cleanup();
    }
  }
);

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

function routedSession(repo, options = {}) {
  return applyContext(createSession({ slug: "safe-approval", sourceDir: repo.root, ...options }), {
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

function evidence(kind, artifact = null) {
  return { kind, command: "node test", exit_code: 0, artifact };
}

function requiredVerdicts(artifactHash) {
  return ["architecture-risk", "test-strategy", "maintainability"].map((lens) => ({
    lens,
    verdict: "pass",
    artifact_hash: artifactHash,
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
      schema_version: 3,
      slug: "safe-approval",
      title: "Safe approval",
      size: "M",
      issues: [
        {
          num: 1,
          title: "Add explicit approval",
          size: "M",
          depends_on: [],
          owns: ["README.md"],
          acceptance_criteria: ["AC-1"],
          approach: "Add an explicit approval boundary.",
          verification_commands: ["node --test tests/rfc-session-state.test.js"],
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
  fs.writeFileSync(
    htmlPath,
    [
      "<!doctype html>",
      '<html lang="en">',
      "<head>",
      '  <meta charset="utf-8">',
      '  <meta name="viewport" content="width=device-width, initial-scale=1">',
      "  <title>Safe approval RFC</title>",
      '  <script id="pm-artifact" type="application/json">{"schema_version":1,"id":"rfc:safe-approval","kind":"rfc","slug":"safe-approval","lifecycle":"draft","title":"Safe approval RFC","generated_at":"2026-07-12T00:00:00Z","generator":{"name":"pm:rfc","version":"test"},"source":{"path":"proposal.md","sha256":null},"evidence":[]}</script>',
      "  <style>:focus-visible{outline:2px solid currentColor}@media(max-width:700px){main{padding:1rem}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto}}@media print{*{overflow:visible!important}}</style>",
      "</head>",
      "<body>",
      '  <script id="rfc-lifecycle" type="application/json">{"status":"draft"}</script>',
      '  <a class="skip-link" href="#content">Skip to content</a>',
      '  <nav aria-label="RFC sections"><a href="#brief">Brief</a></nav>',
      `  <main id="content" data-sidecar-hash="${hash}">`,
      "  <h1>Safe approval RFC</h1>",
      "  <p>Status: <span data-pm-lifecycle>Draft</span></p>",
      '  <section id="brief"></section>',
      '  <code>{"status":"draft"}</code>',
      '  <section id="execution-contract"></section>',
      '  <section id="appendix"></section>',
      '  <section id="test-strategy" class="test-strategy">',
      '    <div class="test-strategy-block"></div>',
      "  </section>",
      '  <article class="issue-detail">',
      '    <span class="issue-detail-num">1</span>',
      '    <span class="issue-detail-title">Add explicit approval</span>',
      '    <span class="issue-detail-size">M</span>',
      '    <span class="hooks-badge">AC-1</span>',
      "  </article>",
      "  </main>",
      "</body>",
      "</html>",
      "",
    ].join("\n")
  );
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

function updateArtifactHtml(repo, artifact, transform) {
  fs.writeFileSync(artifact.html_path, transform(fs.readFileSync(artifact.html_path, "utf8")));
  execFileSync("git", ["add", path.relative(repo.root, artifact.html_path)], { cwd: repo.root });
  execFileSync("git", ["commit", "-qm", "update RFC lifecycle"], { cwd: repo.root });
  return {
    ...artifact,
    html_hash: `sha256:${crypto
      .createHash("sha256")
      .update(fs.readFileSync(artifact.html_path))
      .digest("hex")}`,
    commit: repo.head(),
  };
}

function approveArtifactHtml(html) {
  return html
    .replace('"lifecycle":"draft"', '"lifecycle":"approved"')
    .replace('{"status":"draft"}', '{"status":"approved"}')
    .replace("data-pm-lifecycle>Draft", "data-pm-lifecycle>Approved");
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
