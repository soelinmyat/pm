"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  approveSession,
  buildApprovalAudit,
  createSession,
  proposalIdentityFromPath,
} = require("../scripts/lib/groom-session-schema");
const { proposalContentHash } = require("../scripts/lib/proposal-schema");
const { reviewOutcome, reviewRow } = require("./helpers/groom-review-fixture.js");

test("Groom approval and its audit reject a changed or missing bound prototype", () => {
  const repo = makeRepo();
  try {
    const prototypeRelativePath = "pm/backlog/wireframes/structured-groom.html";
    const prototypePath = path.join(repo, prototypeRelativePath);
    const prototypeBytes = Buffer.from("<main>Reviewed product shape</main>\n");
    fs.mkdirSync(path.dirname(prototypePath), { recursive: true });
    fs.writeFileSync(prototypePath, prototypeBytes);

    const proposal = JSON.parse(
      fs.readFileSync(path.join(__dirname, "fixtures/proposals/strong-v1.json"), "utf8")
    );
    let session = createSession({ slug: "structured-groom", sourceDir: repo, tier: "quick" });
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
    proposal.design_context.prototype = {
      path: prototypeRelativePath,
      sha256: sha256(prototypeBytes),
    };
    proposal.review = {
      status: "passed",
      revision: proposal.revision,
      content_sha256: proposalContentHash(proposal),
      completed_at: "2026-07-14T00:00:00.000Z",
    };
    const proposalPath = path.join(repo, "pm", "backlog", "proposals", `${proposal.slug}.json`);
    fs.mkdirSync(path.dirname(proposalPath), { recursive: true });
    writeProposal(proposalPath, proposal);

    session = approvalSession(session, repo, proposalPath);
    fs.writeFileSync(prototypePath, "<main>Changed after review</main>\n");
    assert.throws(
      () => approveSession(session, { approvedBy: "product-owner" }),
      /prototype binding.*sha256.*does not match repository bytes/i
    );

    fs.rmSync(prototypePath);
    assert.throws(
      () => approveSession(session, { approvedBy: "product-owner" }),
      /prototype binding.*cannot be read as a repository file/i
    );

    fs.writeFileSync(prototypePath, prototypeBytes);
    session = approveSession(
      session,
      { approvedBy: "product-owner" },
      { now: "2026-07-14T01:00:00.000Z" }
    );
    proposal.lifecycle = "approved";
    writeProposal(proposalPath, proposal);

    fs.writeFileSync(prototypePath, "<main>Changed before audit</main>\n");
    assert.throws(
      () => buildApprovalAudit(session),
      /prototype binding.*sha256.*does not match repository bytes/i
    );

    fs.writeFileSync(prototypePath, prototypeBytes);
    assert.equal(buildApprovalAudit(session).kind, "proposal-approval");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

function approvalSession(session, repo, proposalPath) {
  const current = proposalIdentityFromPath(proposalPath, repo);
  const { approval_snapshot_sha256: _approvalSnapshot, ...identity } = current;
  session.phase = "approval";
  session.status = "awaiting_approval";
  session.proposal = identity;
  session.review = {
    status: "passed",
    proposal_hash: identity.content_hash,
    rounds: 1,
    outcomes: session.routing.review_questions.map((question, index) =>
      reviewOutcome(question, identity.content_hash, index)
    ),
    reviewed_at: "2026-07-14T00:30:00.000Z",
  };
  return session;
}

function writeProposal(filePath, proposal) {
  fs.writeFileSync(filePath, `${JSON.stringify(proposal, null, 2)}\n`);
}

function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-groom-prototype-approval-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: root });
  fs.writeFileSync(path.join(root, "README.md"), "fixture\n");
  execFileSync("git", ["add", "README.md"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root });
  return root;
}
