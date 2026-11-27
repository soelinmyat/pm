"use strict";

// Standing merge authorization from the grooming approval to the Dev session:
// Groom records it with the approval decision, the approval audit carries it,
// Dev routing copies it into the session, and dev-session merge-check and
// merge-authorization-revoke read and write it. No network calls.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync, execFileSync } = require("node:child_process");

const groom = require("../scripts/lib/groom-session-schema");
const proposalSchema = require("../scripts/lib/proposal-schema");
const dev = require("../scripts/lib/dev-session-schema");
const auth = require("../scripts/lib/merge-authorization");
const {
  materializeProposalSources,
  reviewOutcome,
  reviewRow,
} = require("./helpers/groom-review-fixture");
const { makeRfcRepo } = require("./helpers/rfc-run-fixture");

const GROOM_CLI = path.resolve(__dirname, "../scripts/groom-session.js");
const DEV_CLI = path.resolve(__dirname, "../scripts/dev-session.js");
let Ajv2020 = null;
let addFormats = null;
try {
  Ajv2020 = require("ajv/dist/2020");
  addFormats = require("ajv-formats");
} catch {
  // Optional dev dependency.
}

function groomForApproval(repo) {
  repo.root = fs.realpathSync(repo.root);
  repo.own("structured-groom");
  const session = groom.createSession({
    slug: "structured-groom",
    sourceDir: repo.root,
    tier: "quick",
  });
  const proposal = JSON.parse(
    fs.readFileSync(path.join(__dirname, "fixtures/proposals/strong-v1.json"))
  );
  proposal.source.session_id = session.run_id;
  proposal.review_contract = {
    session_id: session.run_id,
    tier: "quick",
    required_question_ids: session.routing.review_questions.map((question) => question.id),
  };
  proposal.question_reviews = session.routing.review_questions.map((question, index) =>
    reviewRow(question, index)
  );
  proposal.lifecycle = "reviewed";
  proposal.design_context = {
    design_requirements: proposal.design_requirements.map((item) => item.requirement),
    ui_impact: false,
    prototype: null,
    critical_states: ["draft", "approved", "archived", "error"],
    experience_invariants: ["Every state exposes its next action."],
    visual_invariants: [],
  };
  proposal.review = {
    status: "passed",
    revision: proposal.revision,
    content_sha256: proposalSchema.proposalContentHash(proposal),
    completed_at: "2026-07-14T00:00:00.000Z",
  };
  materializeProposalSources(repo.root, proposal);
  proposal.review.content_sha256 = proposalSchema.proposalContentHash(proposal);
  const proposalPath = path.join(repo.root, "pm/backlog/proposals/structured-groom.json");
  fs.mkdirSync(path.dirname(proposalPath), { recursive: true });
  fs.writeFileSync(proposalPath, JSON.stringify(proposal));
  const { approval_snapshot_sha256: _snapshot, ...identity } = groom.proposalIdentityFromPath(
    proposalPath,
    repo.root
  );
  session.phase = "approval";
  session.status = "awaiting_approval";
  session.proposal = identity;
  session.context.artifact_repo_root = repo.root;
  session.review = {
    status: "passed",
    proposal_hash: identity.content_hash,
    rounds: 1,
    outcomes: session.routing.review_questions.map((question, index) =>
      reviewOutcome(question, identity.content_hash, index)
    ),
    reviewed_at: "2026-07-14T00:30:00.000Z",
  };
  const sessionPath = path.join(repo.root, ".pm/groom-sessions", session.slug, "session.json");
  fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
  fs.writeFileSync(sessionPath, JSON.stringify(session));
  return { proposal, proposalPath, sessionPath };
}

function approve(repo, prepared, extra = []) {
  const result = spawnSync(
    process.execPath,
    [
      GROOM_CLI,
      "approve",
      "--session",
      prepared.sessionPath,
      "--approved-by",
      "product-owner",
      ...extra,
      "--json",
    ],
    { encoding: "utf8" }
  );
  return result;
}

function finishApproval(prepared, session) {
  prepared.proposal.lifecycle = "approved";
  fs.writeFileSync(prepared.proposalPath, JSON.stringify(prepared.proposal));
  const audit = groom.buildApprovalAudit(session);
  const approvalPath = prepared.proposalPath.replace(/\.json$/, ".approval.json");
  fs.writeFileSync(approvalPath, JSON.stringify(audit));
  return { audit, approvalPath };
}

function devSessionFrom(repo, proposalPath) {
  execFileSync("git", ["checkout", "-q", "-b", "structured-groom"], { cwd: repo.root });
  return dev.applyRouting(dev.createSession({ slug: "structured-groom", sourceDir: repo.root }), {
    kind: "proposal",
    risk: {},
    proposal_path: proposalPath,
  });
}

test("grooming approval records a standing merge authorization by default and Dev carries it", () => {
  const repo = makeRfcRepo();
  try {
    const prepared = groomForApproval(repo);
    const approved = approve(repo, prepared);
    assert.equal(approved.status, 0, approved.stderr);
    const session = JSON.parse(approved.stdout).session;
    const record = session.approval.merge_authorization;
    assert.equal(record.status, "granted");
    assert.equal(record.basis, "default");
    assert.equal(record.approved_by, "product-owner");
    assert.equal(record.approved_at, session.approval.approved_at);
    assert.equal(record.groom_run_id, session.run_id);
    assert.equal(record.content_sha256, session.approval.proposal_hash);
    assert.match(JSON.parse(approved.stdout).merge_authorization_notice, /merge/i);

    const { audit, approvalPath } = finishApproval(prepared, session);
    assert.deepEqual(audit.merge_authorization, record);
    const read = proposalSchema.readApprovedProposal(prepared.proposalPath, {
      projectRoot: repo.root,
    });
    assert.deepEqual(read.approval.merge_authorization, record);

    // The approval decision hash binds the record: a swapped record fails.
    const forged = structuredClone(audit);
    forged.merge_authorization = auth.buildMergeAuthorization({
      status: "granted",
      basis: "default",
      groomRunId: record.groom_run_id,
      proposalId: record.proposal_id,
      revision: record.revision,
      contentSha256: record.content_sha256,
      approvedBy: record.approved_by,
      approvedAt: "2026-07-15T00:00:00.000Z",
    });
    fs.writeFileSync(approvalPath, JSON.stringify(forged));
    assert.throws(
      () => proposalSchema.readApprovedProposal(prepared.proposalPath, { projectRoot: repo.root }),
      /merge_authorization|decision/
    );
    fs.writeFileSync(approvalPath, JSON.stringify(audit));

    const devSession = devSessionFrom(repo, prepared.proposalPath);
    const ledger = devSession.merge_authorization;
    assert.deepEqual(ledger.record, record);
    assert.equal(ledger.proposal.decision_id, devSession.task.proposal.decision_id);
    assert.equal(ledger.proposal.path, devSession.task.proposal.path);
    assert.equal(ledger.revoked, null);
    assert.deepEqual(ledger.decisions, []);
    assert.deepEqual(dev.validateSession(devSession), []);
    if (Ajv2020) {
      const ajv = new Ajv2020({ allErrors: true, strict: false });
      addFormats(ajv);
      const schema = JSON.parse(
        fs.readFileSync(path.join(__dirname, "../skills/dev/references/dev-session.schema.json"))
      );
      const valid = ajv.compile(schema);
      assert.equal(valid(devSession), true, JSON.stringify(valid.errors));
    }
  } finally {
    repo.cleanup();
  }
});

test("the approver can decline standing merge authorization for one proposal", () => {
  const repo = makeRfcRepo();
  try {
    const prepared = groomForApproval(repo);
    const approved = approve(repo, prepared, ["--merge", "manual"]);
    assert.equal(approved.status, 0, approved.stderr);
    const session = JSON.parse(approved.stdout).session;
    assert.equal(session.approval.merge_authorization.status, "declined");
    assert.equal(session.approval.merge_authorization.basis, "user-declined");
    finishApproval(prepared, session);
    const devSession = devSessionFrom(repo, prepared.proposalPath);
    assert.equal(devSession.merge_authorization.record.status, "declined");
    const bad = approve(repo, groomForApproval(makeRfcRepo()), ["--merge", "sometimes"]);
    assert.notEqual(bad.status, 0);
  } finally {
    repo.cleanup();
  }
});

test("Merge: manual in the project's PM instructions records a declined authorization", () => {
  const repo = makeRfcRepo();
  try {
    const prepared = groomForApproval(repo);
    fs.writeFileSync(path.join(repo.root, "pm", "instructions.md"), "Merge: manual\n");
    const approved = approve(repo, prepared, ["--merge", "auto"]);
    assert.equal(approved.status, 0, approved.stderr);
    const session = JSON.parse(approved.stdout).session;
    assert.equal(session.approval.merge_authorization.status, "declined");
    assert.equal(session.approval.merge_authorization.basis, "project-merge-manual");
  } finally {
    repo.cleanup();
  }
});

test("an approval made before standing authorization still reads and routes without one", () => {
  const repo = makeRfcRepo();
  try {
    const prepared = groomForApproval(repo);
    const session = groom.approveSession(
      JSON.parse(fs.readFileSync(prepared.sessionPath, "utf8")),
      { approvedBy: "product-owner" }
    );
    assert.equal(session.approval.merge_authorization, undefined);
    fs.writeFileSync(prepared.sessionPath, JSON.stringify(session));
    const { audit } = finishApproval(prepared, session);
    assert.equal(audit.merge_authorization, undefined);
    const devSession = devSessionFrom(repo, prepared.proposalPath);
    assert.equal(devSession.merge_authorization, undefined);
    assert.deepEqual(dev.validateSession(devSession), []);
  } finally {
    repo.cleanup();
  }
});

function writeDevSession(repo, devSession) {
  const sessionPath = path.join(repo.root, ".pm/dev-sessions", devSession.slug, "session.json");
  fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
  fs.writeFileSync(sessionPath, JSON.stringify(devSession, null, 2));
  return sessionPath;
}

function runDev(args, cwd) {
  return spawnSync(process.execPath, [DEV_CLI, ...args], { cwd, encoding: "utf8" });
}

test("merge-check refuses, records why and grants nothing when conditions fail", () => {
  const repo = makeRfcRepo();
  try {
    const prepared = groomForApproval(repo);
    const approved = JSON.parse(approve(repo, prepared).stdout).session;
    fs.writeFileSync(prepared.sessionPath, JSON.stringify(approved));
    finishApproval(prepared, approved);
    const devSession = devSessionFrom(repo, prepared.proposalPath);
    const sessionPath = writeDevSession(repo, devSession);
    const head = repo.head();
    const observationPath = path.join(path.dirname(sessionPath), "ship", "observations", "pr.json");
    fs.mkdirSync(path.dirname(observationPath), { recursive: true });
    fs.writeFileSync(
      observationPath,
      JSON.stringify({
        repository: "acme/widget",
        pr_number: 7,
        state: "OPEN",
        draft: false,
        base: "main",
        default_branch: "main",
        head_oid: head,
        mergeable: "MERGEABLE",
        observed_at: new Date().toISOString(),
        checks: {
          requirements_known: true,
          observation_complete: true,
          required: [{ name: "test" }],
          runs: [{ name: "test", head_sha: head, status: "in_progress", conclusion: null }],
        },
      })
    );
    const checked = runDev(
      [
        "merge-check",
        "--session",
        sessionPath,
        "--observation",
        observationPath,
        "--commit",
        head,
        "--record",
        "--json",
      ],
      repo.root
    );
    assert.equal(checked.status, 1, checked.stderr);
    const result = JSON.parse(checked.stdout);
    assert.equal(result.decision, "refuse");
    const reasonCodes = result.reasons.map((item) => item.code);
    for (const code of ["session-not-at-ship", "gates-missing", "ci-not-green"])
      assert.ok(reasonCodes.includes(code), `${code} in ${reasonCodes}`);
    const stored = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
    assert.equal(stored.merge_authorization.decisions.length, 1);
    assert.equal(stored.merge_authorization.decisions[0].decision, "refuse");
    assert.equal(stored.authority.merge, false);
    assert.deepEqual(dev.validateSession(stored), []);

    const revoked = runDev(
      [
        "merge-authorization-revoke",
        "--session",
        sessionPath,
        "--reason",
        "Owner wants to read this one",
        "--json",
      ],
      repo.root
    );
    assert.equal(revoked.status, 0, revoked.stderr);
    const again = runDev(
      [
        "merge-check",
        "--session",
        sessionPath,
        "--observation",
        observationPath,
        "--commit",
        head,
        "--json",
      ],
      repo.root
    );
    assert.equal(again.status, 3, again.stderr);
    const manual = JSON.parse(again.stdout);
    assert.equal(manual.decision, "manual");
    assert.ok(manual.reasons.some((item) => item.code === "authorization-revoked"));
    const status = runDev(["merge-authorization", "--session", sessionPath, "--json"], repo.root);
    assert.equal(status.status, 3, status.stderr);
    assert.equal(JSON.parse(status.stdout).applies, false);
    assert.deepEqual(
      JSON.parse(status.stdout).reasons.map((item) => item.code),
      ["authorization-revoked"]
    );
  } finally {
    repo.cleanup();
  }
});

test("merge-authorization grants push and PR creation only while the authorization applies", () => {
  const repo = makeRfcRepo();
  try {
    const prepared = groomForApproval(repo);
    const approved = JSON.parse(approve(repo, prepared).stdout).session;
    fs.writeFileSync(prepared.sessionPath, JSON.stringify(approved));
    finishApproval(prepared, approved);
    const sessionPath = writeDevSession(repo, devSessionFrom(repo, prepared.proposalPath));
    const shown = runDev(
      ["merge-authorization", "--session", sessionPath, "--apply", "--json"],
      repo.root
    );
    assert.equal(shown.status, 0, shown.stderr);
    const report = JSON.parse(shown.stdout);
    assert.equal(report.applies, true);
    const stored = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
    assert.equal(stored.authority.push_feature_branch, true);
    assert.equal(stored.authority.create_pr, true);
    assert.equal(stored.authority.merge, false);
    assert.ok(stored.authority_log.at(-1).reason.startsWith(auth.GRANT_REASON_PREFIX));

    fs.writeFileSync(path.join(repo.root, "pm", "instructions.md"), "Merge: manual\n");
    const off = runDev(
      ["merge-authorization", "--session", sessionPath, "--apply", "--json"],
      repo.root
    );
    assert.equal(off.status, 3, off.stderr);
    assert.equal(JSON.parse(off.stdout).applies, false);
  } finally {
    repo.cleanup();
  }
});
