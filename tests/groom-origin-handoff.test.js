"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { promote } = require("../scripts/product-reasoning");
const { validate } = require("../scripts/validate");
const { validateDecisionBrief, decisionId } = require("../scripts/lib/product-reasoning-schema");
const { verifyDecisionBriefBindings } = require("../scripts/lib/product-reasoning-bindings");
const {
  buildApproval,
  deriveApprovalDecision,
  proposalContentHash,
  readApprovedProposal,
} = require("../scripts/lib/proposal-schema");
const {
  bindCurrentReviewContract,
  materializeProposalSources,
} = require("./helpers/groom-review-fixture");
const sha = (bytes) => `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;

function fixture(t) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "groom-renamed-origin-"));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  const root = path.join(project, "pm");
  const origin = "thinking/alternate-direction.decision.json";
  const reader = "thinking/alternate-direction.md";
  const target = "backlog/proposals/retained-proposal.json";
  const audit = target.replace(/\.json$/, ".approval.json");
  const write = (rel, value) => {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, value);
  };
  const brief = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../evals/product-reasoning-quality/strong/decision.json"))
  );
  brief.kind = "think";
  delete brief.alignment;
  brief.slug = "alternate-direction";
  brief.decision_id = decisionId("think", brief.slug);
  const originalReader = `---\nstatus: active\nreasoning_version: 2\ndecision_brief: ${origin}\npromoted_to: null\n---\n# Alternate direction\n`;
  brief.source_artifacts = [{ path: reader, sha256: sha(originalReader) }];
  write(reader, originalReader);
  write(origin, JSON.stringify(brief));
  const original = fs.readFileSync(path.join(root, origin));
  const proposal = JSON.parse(
    fs.readFileSync(path.join(__dirname, "fixtures/proposals/strong-v1.json"))
  );
  proposal.slug = "retained-proposal";
  proposal.id = "proposal:retained-proposal";
  bindCurrentReviewContract(proposal);
  materializeProposalSources(project, proposal);
  proposal.source.lineage.push({
    id: "source:origin",
    path: `pm/${origin}`,
    sha256: sha(original),
  });
  proposal.evidence.push({ ...proposal.evidence[0], id: "evidence:origin", path: `pm/${origin}` });
  const approve = () => {
    proposal.lifecycle = "approved";
    proposal.review = {
      status: "passed",
      revision: proposal.revision,
      content_sha256: proposalContentHash(proposal),
      completed_at: "2026-07-14T01:00:00.000Z",
    };
    const bytes = Buffer.from(JSON.stringify(proposal));
    const options = { approvedBy: "user:owner", approvedAt: "2026-07-14T01:30:00.000Z" };
    const decision = deriveApprovalDecision(proposal, options);
    write(target, bytes);
    write(
      audit,
      JSON.stringify(
        buildApproval(proposal, bytes, {
          ...options,
          decisionId: decision.id,
          decisionSha256: decision.sha256,
        })
      )
    );
    return decision;
  };
  const request = {
    decision_path: origin,
    target_ref: target,
    confirmed_at: "2026-07-14T02:00:00Z",
    approval_decision: approve(),
    binding_paths: [target, audit, reader],
  };
  write(
    reader,
    originalReader
      .replace("status: active", "status: promoted")
      .replace("promoted_to: null", "promoted_to: retained-proposal")
  );
  return { root, origin, reader, target, audit, write, original, proposal, approve, request };
}

test("Think promotion preserves exact approval when the selected proposal keeps a different slug", (t) => {
  const f = fixture(t);
  const bytes = fs.readFileSync(path.join(f.root, f.target));
  assert.equal(promote(f.root, f.request).promoted, true);
  assert.doesNotThrow(() =>
    readApprovedProposal(path.join(f.root, f.target), {
      projectRoot: path.dirname(f.root),
      expectedDecision: f.request.approval_decision,
    })
  );
  const brief = JSON.parse(fs.readFileSync(path.join(f.root, f.origin)));
  assert.deepEqual(validateDecisionBrief(brief), []);
  assert.deepEqual(verifyDecisionBriefBindings(f.root, brief), []);
  assert.deepEqual(fs.readFileSync(path.join(f.root, f.target)), bytes);
  f.write(
    f.reader,
    fs
      .readFileSync(path.join(f.root, f.reader), "utf8")
      .replace("promoted_to: retained-proposal", "promoted_to: alternate-direction")
  );
  brief.source_artifacts.find((a) => a.path === f.reader).sha256 = sha(
    fs.readFileSync(path.join(f.root, f.reader))
  );
  assert.match(verifyDecisionBriefBindings(f.root, brief).join("\n"), /promoted_to/);
});

test("cross-slug promotion still rejects absent lineage and leaves its origin untouched", (t) => {
  const f = fixture(t);
  f.proposal.source.lineage.pop();
  f.proposal.evidence.pop();
  f.request.approval_decision = f.approve();
  assert.throws(() => promote(f.root, f.request), /source lineage must bind/);
  assert.deepEqual(fs.readFileSync(path.join(f.root, f.origin)), f.original);
});

test("cross-slug promotion rejects approval mismatch and noncanonical targets", (t) => {
  const f = fixture(t);
  assert.throws(
    () =>
      promote(f.root, {
        ...f.request,
        approval_decision: { ...f.request.approval_decision, sha256: `sha256:${"0".repeat(64)}` },
      }),
    /decision/
  );
  const target = "backlog/proposals/nested/retained-proposal.json";
  assert.throws(
    () =>
      promote(f.root, {
        ...f.request,
        target_ref: target,
        binding_paths: [target, target.replace(/\.json$/, ".approval.json"), f.reader],
      }),
    /target_ref/
  );
  assert.deepEqual(fs.readFileSync(path.join(f.root, f.origin)), f.original);
});

test("normal KB validation accepts the generated proposal ID namespace only on matching proposal readers", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "proposal-id-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "backlog"));
  const file = path.join(root, "backlog/example.md");
  const body =
    "---\ntype: backlog\nid: proposal:example\nkind: proposal\ntitle: Example\noutcome: Inspect recorded work\nstatus: proposed\npriority: medium\ncreated: 2026-07-14\nupdated: 2026-07-14\nprd: proposals/example.html\n---\n";
  fs.writeFileSync(file, body);
  assert.deepEqual(
    validate(root).errors.filter((e) => e.field === "id"),
    []
  );
  for (const changed of [
    body.replace("proposal:example", "proposal:other"),
    body.replace("kind: proposal", "kind: task"),
    body.replace("proposals/example.html", "proposals/other.html"),
  ]) {
    fs.writeFileSync(file, changed);
    assert.ok(validate(root).errors.some((e) => e.field === "id"));
  }
});

test("retained origin preimage rejects altered evidence bytes", (t) => {
  const f = fixture(t);
  promote(f.root, f.request);
  const brief = JSON.parse(fs.readFileSync(path.join(f.root, f.origin)));
  assert.equal(brief.promotion.origin_decision_json, f.original.toString("utf8"));
  brief.promotion.origin_decision_json += " ";
  f.write(f.origin, JSON.stringify(brief));
  assert.throws(
    () => readApprovedProposal(path.join(f.root, f.target), { projectRoot: path.dirname(f.root) }),
    /retained source bytes/
  );
  assert.ok(validateDecisionBrief(brief).some((issue) => /origin_decision_json/.test(issue)));
});
