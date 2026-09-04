"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { applyRouting, createSession, nextDecision } = require("../scripts/lib/dev-session-schema");
const {
  buildApproval,
  deriveApprovalDecision,
  proposalContentHash,
} = require("../scripts/lib/proposal-schema");
const {
  bindCurrentReviewContract,
  materializeProposalSources,
} = require("./helpers/groom-review-fixture.js");

test("direct proposal intake preserves approved design context and detects later drift", () => {
  const repo = makeRepo();
  try {
    const prepared = writeApprovedProposal(repo, { size: "S", withPrototype: true });
    const session = applyRouting(createSession({ slug: prepared.proposal.slug, sourceDir: repo }), {
      kind: "proposal",
      risk: {},
      proposal_path: prepared.proposalPath,
      work_units: [
        {
          id: "direct-ui",
          title: "Implement the approved interface",
          depends_on: [],
          owns: ["src/interface.js"],
          contract: {
            acceptance_criteria: ["Preserve the approved experience"],
            approach: "Implement the directly approved proposal.",
            verification_commands: ["node --test"],
            test_hooks: ["approved-interface"],
          },
          status: "pending",
        },
      ],
    });

    assert.equal(session.task.size, "S");
    assert.ok(session.routing.required_gates.includes("design-critique"));
    assert.ok(session.routing.required_gates.includes("qa"));
    assert.deepEqual(session.task.design_context, prepared.proposal.design_context);
    assert.deepEqual(
      session.task.work_units[0].contract.design_context,
      prepared.proposal.design_context
    );
    assert.doesNotThrow(() => nextDecision(session));

    assert.throws(
      () =>
        applyRouting(createSession({ slug: "caller-mismatch", sourceDir: repo }), {
          kind: "proposal",
          risk: {},
          proposal_path: prepared.proposalPath,
          design_context: {
            ...prepared.proposal.design_context,
            visual_invariants: ["A caller-supplied substitute."],
          },
        }),
      /design_context contradicts the canonical proposal/
    );

    const driftedTaskContext = structuredClone(session);
    driftedTaskContext.task.design_context.visual_invariants = ["A persisted substitute."];
    assert.throws(() => nextDecision(driftedTaskContext), /proposal design_context drifted/);

    const driftedWorkerContext = structuredClone(session);
    driftedWorkerContext.task.work_units[0].contract.design_context.critical_states = [
      "primary only",
    ];
    assert.throws(
      () => nextDecision(driftedWorkerContext),
      /work unit direct-ui design_context drifted/
    );

    fs.writeFileSync(prepared.prototypePath, "<main>Unapproved prototype drift</main>\n");
    assert.throws(
      () => nextDecision(session),
      /prototype.*sha256.*does not match repository bytes/i
    );
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("direct proposal intake rejects legacy approval without durable design context", () => {
  const repo = makeRepo();
  try {
    const prepared = writeApprovedProposal(repo, { size: "XS", withDesignContext: false });
    assert.throws(
      () =>
        applyRouting(createSession({ slug: "legacy", sourceDir: repo }), {
          kind: "proposal",
          risk: {},
          proposal_path: prepared.proposalPath,
        }),
      /lacks durable design_context/
    );
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

function writeApprovedProposal(repo, { size, withDesignContext = true, withPrototype = false }) {
  const proposal = JSON.parse(
    fs.readFileSync(path.join(__dirname, "fixtures/proposals/strong-v1.json"), "utf8")
  );
  proposal.size = size;
  if (!withDesignContext) delete proposal.design_context;
  bindCurrentReviewContract(proposal, "full");
  materializeProposalSources(repo, proposal);
  let prototypePath = null;
  if (withPrototype) {
    const prototypeRelativePath = "pm/backlog/wireframes/structured-groom.html";
    prototypePath = path.join(repo, prototypeRelativePath);
    const prototypeBytes = Buffer.from("<main>Approved product shape</main>\n");
    fs.mkdirSync(path.dirname(prototypePath), { recursive: true });
    fs.writeFileSync(prototypePath, prototypeBytes);
    proposal.design_context.prototype = {
      path: prototypeRelativePath,
      sha256: sha256(prototypeBytes),
    };
  }
  proposal.lifecycle = "approved";
  proposal.review = {
    status: "passed",
    revision: proposal.revision,
    content_sha256: proposalContentHash(proposal),
    completed_at: "2026-07-14T02:00:00.000Z",
  };
  const proposalPath = path.join(repo, "pm", "backlog", "proposals", `${proposal.slug}.json`);
  const approvalPath = proposalPath.replace(/\.json$/, ".approval.json");
  fs.mkdirSync(path.dirname(proposalPath), { recursive: true });
  fs.writeFileSync(proposalPath, `${JSON.stringify(proposal, null, 2)}\n`);
  const approvalInput = {
    approvedBy: "user:owner",
    approvedAt: "2026-07-14T03:00:00.000Z",
  };
  const decision = deriveApprovalDecision(proposal, approvalInput);
  const approval = buildApproval(proposal, fs.readFileSync(proposalPath), {
    ...approvalInput,
    decisionId: decision.id,
    decisionSha256: decision.sha256,
  });
  fs.writeFileSync(approvalPath, `${JSON.stringify(approval, null, 2)}\n`);
  proposal.lifecycle = "planned";
  proposal.updated_at = "2026-07-14T04:00:00.000Z";
  fs.writeFileSync(proposalPath, `${JSON.stringify(proposal, null, 2)}\n`);
  return { proposal, proposalPath, prototypePath };
}

function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-dev-proposal-context-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: root });
  fs.writeFileSync(path.join(root, "README.md"), "fixture\n");
  execFileSync("git", ["add", "README.md"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root });
  return root;
}
