"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const proposal = require("../scripts/lib/proposal-schema");
const groom = require("../scripts/lib/groom-session-schema");
const rfc = require("../scripts/lib/rfc-session-schema");
const dev = require("../scripts/lib/dev-session-schema");
const preview = require("../scripts/lib/app-preview");
const { renderProposal } = require("../scripts/proposal-render");
const { verifyRfcApproval } = require("../scripts/lib/rfc-approval-audit");
const { rfcIssuesToDevWorkUnits } = require("../scripts/lib/rfc-work-units");
const {
  makeRfcRepo,
  phaseResult,
  resultEvidence,
  recordFile,
  relabelArtifact,
} = require("./helpers/rfc-run-fixture");
const {
  approvedProduct,
  configuredRfc,
  writeProductArtifact,
  preservationVerdicts,
} = require("./fixtures/product-autonomy/handoff");
const Ajv2020 = require("ajv/dist/2020");
const addFormats = require("ajv-formats");
const fixtureRoot = path.join(__dirname, "fixtures/product-autonomy");
function git(root, ...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" }).trim();
}
function valueDecision() {
  const source = JSON.parse(
    fs.readFileSync(path.join(__dirname, "fixtures/proposals/strong-v1.json"))
  );
  const evidence = [source.evidence[0].id],
    assumptions = [source.assumptions[0].id];
  const claim = (statement) => ({ statement, evidence_ids: evidence, assumption_ids: [] });
  return {
    schema_version: 1,
    beneficiary: claim("Shift workers retaining context across a manual save."),
    buyer: {
      status: "unknown",
      statement: "Buyer and willingness to pay remain unverified.",
      evidence_ids: [],
      assumption_ids: [],
    },
    user_outcome: claim("Return to partial work with saved checks and a note."),
    commercial_hypothesis: {
      ...claim("Easier continuity may support adoption; commercial demand is a hypothesis."),
      assumption_ids: assumptions,
    },
    counterevidence: {
      status: "not-found",
      statement:
        "The checked synthetic workflow does not establish customer demand or contrary commercial evidence.",
      evidence_ids: evidence,
    },
    uncertainties: [
      {
        statement: "Value to an actual buyer remains unknown.",
        evidence_ids: [],
        assumption_ids: assumptions,
      },
    ],
    recommendation: {
      decision: "test-first",
      rationale: "Observe the task before assigning commercial confidence.",
      evidence_ids: evidence,
      assumption_ids: assumptions,
    },
    discriminating_test: {
      action: "Observe entry, manual Save, leave and return in the existing app.",
      observable_result: "The worker resumes partial work without losing context.",
      reversal_condition:
        "Defer if the incumbent route is clearer or the outcome has no customer value.",
      evidence_ids: evidence,
      assumption_ids: assumptions,
    },
  };
}
function appIdentity(repo) {
  fs.cpSync(path.join(fixtureRoot, "app"), repo.root, { recursive: true });
  fs.writeFileSync(path.join(repo.root, ".gitignore"), ".pm/\n");
  git(
    repo.root,
    "add",
    "app.mjs",
    "index.html",
    "package.json",
    "server.cjs",
    "ui",
    "preview-data",
    ".gitignore"
  );
  git(repo.root, "commit", "-qm", "Incumbent isolated pilot app");
  const base = repo.head(),
    sourceRoot = path.join(repo.root, ".pm/pilot-preview");
  git(repo.root, "worktree", "add", "--detach", sourceRoot, base);
  for (const [source, dest] of [
    ["accepted-app.mjs", "app.mjs"],
    ["accepted-components.mjs", "ui/components.mjs"],
  ])
    fs.copyFileSync(path.join(fixtureRoot, source), path.join(sourceRoot, dest));
  git(sourceRoot, "add", "app.mjs", "ui/components.mjs");
  git(sourceRoot, "commit", "-qm", "Reviewed manual Save journey");
  fs.mkdirSync(path.join(sourceRoot, ".pm/fixtures"), { recursive: true });
  fs.copyFileSync(
    path.join(sourceRoot, "preview-data/jobs.json"),
    path.join(sourceRoot, ".pm/fixtures/jobs.json")
  );
  const candidate = preview.prepareAppPreview(
    {
      repository: "isolated-pilot",
      base_commit: base,
      reviewed_paths: ["app.mjs", "ui/components.mjs"],
      fixture_directory: ".pm/fixtures",
      launch: {
        executable: "node",
        args: ["server.cjs"],
        cwd: ".",
        url: "http://127.0.0.1:4176",
        env: { PM_PREVIEW_FIXTURES: ".pm/fixtures", PM_PREVIEW_PORT: "4176" },
      },
      journeys: [
        {
          id: "save-return",
          purpose: "Manual Save preserves the incumbent detail, gallery and drawer composition",
          required_states: ["entry", "saved", "returned", "long-content"],
        },
      ],
    },
    { sourceRoot, repoRoot: repo.root }
  );
  fs.mkdirSync(path.join(repo.root, "evidence"), { recursive: true });
  fs.writeFileSync(
    path.join(repo.root, "evidence/state.json"),
    JSON.stringify({ fixture_only: true, note_restored: true, checkpoints: 20, photos: 20 })
  );
  const observation = {
    capture_id: candidate.capture.id,
    input_sha256: candidate.capture.input_sha256,
    recorded_at: new Date().toISOString(),
    observer: "Synthetic contract test; separate manual browser pilot owns pixel verification",
    backend_certified: false,
    journeys: [
      {
        id: "save-return",
        steps: [
          "Normal entry",
          "Save partial progress",
          "Leave and return",
          "Inspect long content",
        ],
        states: candidate.journeys[0].required_states.map((id) => ({
          id,
          evidence: "evidence/state.json",
        })),
      },
    ],
  };
  fs.writeFileSync(path.join(repo.root, "evidence/receipt.json"), JSON.stringify(observation));
  return {
    sourceRoot,
    identity: preview.completeAppPreview(
      candidate,
      { receipt: "evidence/receipt.json", ...observation },
      { sourceRoot, repoRoot: repo.root }
    ),
  };
}

function ownedGroomRoot(root, slug) {
  const branch = `codex/${slug}-groom`,
    worktree = path.join(root, ".pm", `artifact-${slug}`);
  git(root, "remote", "add", "origin", root);
  git(root, "worktree", "add", "-q", "-b", branch, worktree);
  const urlHash = require("node:crypto").createHash("sha256").update(root).digest("hex");
  for (const [key, value] of [
    ["Base", git(root, "rev-parse", "HEAD")],
    ["Kind", "groom"],
    ["Remote", "origin"],
    ["DefaultBranch", "main"],
    ["RemoteUrlSha256", urlHash],
  ])
    git(root, "config", `branch.${branch}.pmArtifact${key}`, value);
  return worktree;
}

test("new Groom CLI opts into value contract; configuration cannot erase the producer marker", () => {
  const repo = makeRfcRepo();
  try {
    const artifactRoot = ownedGroomRoot(repo.root, "current-value");
    const cli = path.resolve(__dirname, "../scripts/groom-session.js");
    const result = spawnSync(
      process.execPath,
      [
        cli,
        "init",
        "--slug",
        "current-value",
        "--source-dir",
        repo.root,
        "--tier",
        "quick",
        "--json",
      ],
      { encoding: "utf8" }
    );
    assert.equal(result.status, 0, result.stderr);
    const session = JSON.parse(result.stdout).session;
    assert.equal(
      session.context.product_contract_version,
      1,
      "new producer must require the structured value brief"
    );
    const configured = groom.applyContext(session, {
      title: "Current value",
      outcome: "Make a grounded decision",
      source_kind: "idea",
      evidence_refs: [],
      artifact_repo_root: artifactRoot,
    });
    assert.equal(configured.context.product_contract_version, 1);
    for (const version of [0, "1", null]) {
      const forged = structuredClone(configured);
      forged.context.product_contract_version = version;
      assert.ok(groom.validateSession(forged).length);
    }
  } finally {
    repo.cleanup();
  }
});

test("new Groom rejects absent value while historical omission remains readable and malformed presence rejects", () => {
  const repo = makeRfcRepo();
  try {
    assert.throws(
      () => approvedProduct(repo, true, { current: true }),
      /value_decision|value decision/
    );
    const legacy = approvedProduct(repo, false);
    assert.ok(proposal.readApprovedProposal(legacy.path, { projectRoot: repo.root }));
    const malformed = JSON.parse(fs.readFileSync(legacy.path));
    malformed.decision_brief.value_decision = null;
    fs.writeFileSync(legacy.path, JSON.stringify(malformed));
    assert.throws(
      () => groom.proposalIdentityFromPath(legacy.path, repo.root),
      /value_decision|value decision/
    );
  } finally {
    repo.cleanup();
  }
});

test("actual app preview, value and exact product delegation reach RFC handoff and executable Dev readiness", () => {
  const repo = makeRfcRepo();
  try {
    const app = appIdentity(repo),
      value = valueDecision();
    const product = approvedProduct(repo, true, {
      current: true,
      preview: app.identity,
      previewSourceRoot: app.sourceRoot,
      valueDecision: value,
    });
    const uncovered = structuredClone(product.proposal);
    uncovered.design_context.critical_states.push("unobserved-error");
    assert.equal(
      proposal.validateProposal(uncovered, {
        projectRoot: repo.root,
        previewSourceRoot: app.sourceRoot,
      }).ok,
      false
    );
    const trusted = proposal.readApprovedProposal(product.path, {
      projectRoot: repo.root,
      previewSourceRoot: app.sourceRoot,
    });
    assert.deepEqual(trusted.contract.value_decision, value);
    const rendered = renderProposal(product.proposal, {
      sourceBytes: fs.readFileSync(product.path),
      actuallyVerifiedApproval: trusted,
    });
    assert.match(rendered.html, /Runnable in-app preview/);
    assert.match(rendered.html, /Buyer \(unknown\)/);
    assert.match(rendered.markdown, /Change the decision when/);
    let session = configuredRfc(repo, product, app.sourceRoot);
    session = rfc.recordResult(session, phaseResult(session));
    let artifact = writeProductArtifact(repo, session, product);
    session = rfc.recordResult(
      session,
      phaseResult(session, { artifact, evidence: [resultEvidence("artifact")] })
    );
    const material = preservationVerdicts(session, artifact);
    material[0].delegation_scope.boundaries.privacy = "material-change";
    assert.throws(
      () =>
        rfc.recordResult(
          session,
          phaseResult(session, {
            artifact,
            evidence: [resultEvidence("review")],
            reviewer_verdicts: material,
          })
        ),
      /preserv|material/
    );
    session = rfc.recordResult(
      session,
      phaseResult(session, {
        artifact,
        evidence: [resultEvidence("review")],
        reviewer_verdicts: preservationVerdicts(session, artifact),
      })
    );
    assert.equal(session.approval.status, "delegated");
    const sessionPath = path.join(repo.root, ".pm/rfc-sessions", session.slug, "session.json");
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
    fs.writeFileSync(sessionPath, JSON.stringify(session));
    artifact = relabelArtifact(repo, session.slug, artifact, "reviewed");
    const auditPath = artifact.json_path.replace(/\.json$/, ".approval.json");
    const audit = rfc.buildApprovalAudit(session, artifact);
    fs.writeFileSync(auditPath, JSON.stringify(audit));
    git(repo.root, "add", path.relative(repo.root, auditPath));
    git(repo.root, "commit", "-qm", "Exact delegated audit");
    artifact = { ...artifact, commit: repo.head() };
    const done = recordFile(
      repo,
      session,
      phaseResult(session, {
        artifact,
        evidence: [
          resultEvidence("handoff"),
          resultEvidence("lifecycle"),
          resultEvidence("approval-audit", auditPath),
        ],
      })
    );
    assert.equal(done.status, 0, done.stderr);
    const verified = verifyRfcApproval({
      sidecarPath: artifact.json_path,
      slug: session.slug,
      archiveRepoRoot: repo.root,
    });
    assert.equal(verified.delegation.grant_sha256, product.audit.delivery_delegation.grant_sha256);
    const sidecar = JSON.parse(fs.readFileSync(artifact.json_path));
    let delivery = dev.applyRouting(
      dev.createSession({ slug: session.slug, sourceDir: repo.root }),
      {
        kind: "proposal",
        size: sidecar.size,
        risk: { ui: 1 },
        preview_source_root: app.sourceRoot,
        design_context: sidecar.design_context,
        work_units: rfcIssuesToDevWorkUnits(sidecar, {
          repoRoot: repo.root,
          previewSourceRoot: app.sourceRoot,
        }),
      },
      {
        rfcSidecar: {
          path: artifact.json_path,
          sha256: artifact.sidecar_hash,
          schema_version: 3,
          slug: session.slug,
        },
      }
    );
    const sessionSchema = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, "../skills/dev/references/dev-session.schema.json"))
    );
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    const checkPersisted = ajv.compile(sessionSchema);
    assert.equal(checkPersisted(delivery), true, JSON.stringify(checkPersisted.errors));
    delivery.phase = "readiness";
    const readiness = {
      schema_version: 1,
      run_id: delivery.run_id,
      phase: delivery.phase,
      attempt: delivery.phase_attempt,
      status: "passed",
      summary: "Exact reviewed delegated RFC is ready",
      commit: null,
      files_changed: [],
      evidence: [
        {
          kind: "rfc-readiness",
          command: "rfc-sidecar-check.js --current-handoff",
          exit_code: 0,
          artifact: artifact.json_path,
        },
      ],
      blocker: null,
      runtime: { provider: "inline", model: "inherit", reasoning: "inherit", session_id: null },
    };
    delivery = dev.recordResult(delivery, readiness);
    assert.equal(delivery.phase, "implementation");
    assert.equal(delivery.authority.push_feature_branch, false);
    const original = fs.readFileSync(path.join(app.sourceRoot, ".pm/fixtures/jobs.json"));
    fs.appendFileSync(path.join(app.sourceRoot, ".pm/fixtures/jobs.json"), "drift");
    assert.throws(() => dev.nextDecision(delivery), /fixture/);
    fs.writeFileSync(path.join(app.sourceRoot, ".pm/fixtures/jobs.json"), original);
    const target = path.join(repo.root, ".pm/pilot-delivery");
    git(repo.root, "worktree", "add", "--detach", target, app.identity.source.base_commit);
    const adoption = preview.adoptAppPreview(app.identity, {
      repoRoot: repo.root,
      sourceRoot: app.sourceRoot,
      targetRoot: target,
    });
    assert.equal(adoption.backend_certified, false);
    assert.equal(fs.existsSync(path.join(target, ".pm/fixtures")), false);
    assert.deepEqual(git(target, "diff", "--cached", "--name-only").split("\n"), [
      "app.mjs",
      "ui/components.mjs",
    ]);
    const changed = JSON.parse(fs.readFileSync(product.path));
    changed.decision_brief.value_decision.recommendation.rationale = "A new commercial claim";
    fs.writeFileSync(product.path, JSON.stringify(changed));
    assert.throws(
      () =>
        verifyRfcApproval({
          sidecarPath: artifact.json_path,
          slug: session.slug,
          archiveRepoRoot: repo.root,
        }),
      /proposal|decision|hash|review/
    );
  } finally {
    repo.cleanup();
  }
});
