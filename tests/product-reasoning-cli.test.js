"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { buildApproval, proposalContentHash } = require("../scripts/lib/proposal-schema");
const { promote } = require("../scripts/product-reasoning");

const CLI = path.join(__dirname, "..", "scripts", "product-reasoning.js");

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
}

test("identity commands are deterministic and reject incomplete arguments", () => {
  const first = run(["decision-id", "--kind", "think", "--slug", "retention-loop"]);
  const second = run(["decision-id", "--kind", "think", "--slug", "retention-loop"]);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stdout, second.stdout);
  assert.match(first.stdout, /dec-[a-f0-9]{20}/);
  assert.equal(run(["feature-id", "--project", "example"]).status, 1);
});

test("validate dispatches only known product reasoning document types", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-reasoning-cli-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const unknown = path.join(root, "unknown.json");
  fs.writeFileSync(unknown, JSON.stringify({ document_type: "other" }));
  const result = run(["validate", "--root", root, "--input", unknown]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /document_type must be decision-brief or feature-inventory/);
});

test("JSON inputs reject symbolic links", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-reasoning-link-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, "target.json");
  const link = path.join(root, "link.json");
  fs.writeFileSync(target, "{}");
  fs.symlinkSync(target, link);
  const result = run(["validate", "--root", root, "--input", link]);
  assert.equal(result.status, 1);
  assert.ok(result.stderr.length > 0);
});

test("decision validation authenticates canonical Markdown binding bytes", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-reasoning-binding-cli-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "backlog"));
  const markdown = Buffer.from("# Guided evidence refresh\n");
  fs.writeFileSync(path.join(root, "backlog", "guided-evidence-refresh.md"), markdown);
  const brief = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "..", "evals", "product-reasoning-quality", "strong", "decision.json"),
      "utf8"
    )
  );
  brief.source_artifacts[0].sha256 = `sha256:${crypto
    .createHash("sha256")
    .update(markdown)
    .digest("hex")}`;
  const input = path.join(root, "backlog", "guided-evidence-refresh.decision.json");
  fs.writeFileSync(input, JSON.stringify(brief));
  let result = run(["validate", "--root", root, "--input", input]);
  assert.equal(result.status, 0, result.stderr);
  fs.writeFileSync(path.join(root, "backlog", "guided-evidence-refresh.md"), "# Changed\n");
  result = run(["validate", "--root", root, "--input", input]);
  assert.equal(result.status, 2);
  assert.match(result.stdout, /SHA-256 does not match/);
  fs.rmSync(path.join(root, "backlog", "guided-evidence-refresh.md"));
  result = run(["validate", "--root", root, "--input", input]);
  assert.equal(result.status, 2);
  assert.match(result.stdout, /existing regular file|ENOENT/);
});

test("feature-snapshot publishes deterministic bounded non-Git provenance", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-feature-snapshot-cli-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "feature.js"), "export const feature = true;\n");
  const request = path.join(root, "request.json");
  fs.writeFileSync(request, JSON.stringify({ source_refs: ["src/feature.js"] }));
  const first = run(["feature-snapshot", "--source-root", root, "--request", request]);
  const second = run(["feature-snapshot", "--source-root", root, "--request", request]);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stdout, second.stdout);
  assert.match(first.stdout, /"snapshot_sha256": "sha256:[a-f0-9]{64}"/);
});

test("promote requires exact approved Groom lineage and atomically closes origin lineage", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-reasoning-promote-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const decisionPath = "backlog/guided-evidence-refresh.decision.json";
  const targetRef = "backlog/proposals/guided-evidence-refresh.json";
  const approvalRef = "backlog/proposals/guided-evidence-refresh.approval.json";
  const markdownPath = "backlog/guided-evidence-refresh.md";
  fs.mkdirSync(path.join(root, "backlog", "proposals"), { recursive: true });
  const sourceFixture = path.join(
    __dirname,
    "..",
    "evals",
    "product-reasoning-quality",
    "strong",
    "decision.json"
  );
  fs.copyFileSync(sourceFixture, path.join(root, decisionPath));
  fs.writeFileSync(path.join(root, markdownPath), "# Guided evidence refresh\n");
  const proposal = JSON.parse(
    fs.readFileSync(path.join(__dirname, "fixtures", "proposals", "strong-v1.json"), "utf8")
  );
  proposal.slug = "guided-evidence-refresh";
  proposal.id = "proposal:guided-evidence-refresh";
  const originBytes = fs.readFileSync(path.join(root, decisionPath));
  proposal.source.lineage.push({
    id: "source:idea-origin",
    path: decisionPath,
    sha256: `sha256:${crypto.createHash("sha256").update(originBytes).digest("hex")}`,
  });
  fs.writeFileSync(path.join(root, targetRef), `${JSON.stringify(proposal, null, 2)}\n`);
  const requestPath = path.join(root, "request.json");
  const approvalDecision = { id: "groom-decision-01", sha256: `sha256:${"2".repeat(64)}` };
  fs.writeFileSync(
    requestPath,
    JSON.stringify({
      decision_path: decisionPath,
      target_ref: targetRef,
      confirmed_at: "2026-07-14T02:00:00Z",
      approval_decision: approvalDecision,
      binding_paths: [targetRef, approvalRef, markdownPath],
    })
  );

  const requestValue = JSON.parse(fs.readFileSync(requestPath, "utf8"));
  fs.writeFileSync(
    requestPath,
    JSON.stringify({
      ...requestValue,
      binding_paths: requestValue.binding_paths.filter((entry) => entry !== markdownPath),
    })
  );
  let result = run(["promote", "--root", root, "--request", requestPath]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /canonical origin/);
  fs.writeFileSync(requestPath, JSON.stringify(requestValue));

  assert.throws(
    () =>
      promote(root, {
        ...requestValue,
        target_ref: "backlog/proposals/alternate/guided-evidence-refresh.json",
        binding_paths: [
          "backlog/proposals/alternate/guided-evidence-refresh.json",
          "backlog/proposals/alternate/guided-evidence-refresh.approval.json",
          markdownPath,
        ],
      }),
    /target_ref must equal/
  );

  result = run(["promote", "--root", root, "--request", requestPath]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /not approved/);

  proposal.lifecycle = "approved";
  proposal.review = {
    status: "passed",
    revision: proposal.revision,
    content_sha256: proposalContentHash(proposal),
    completed_at: "2026-07-14T01:00:00.000Z",
  };
  const proposalBytes = Buffer.from(`${JSON.stringify(proposal, null, 2)}\n`);
  fs.writeFileSync(path.join(root, targetRef), proposalBytes);
  result = run(["promote", "--root", root, "--request", requestPath]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /approval/);

  const approval = buildApproval(proposal, proposalBytes, {
    approvedBy: "user:owner",
    approvedAt: "2026-07-14T01:30:00.000Z",
    decisionId: approvalDecision.id,
    decisionSha256: approvalDecision.sha256,
  });
  fs.writeFileSync(path.join(root, approvalRef), `${JSON.stringify(approval, null, 2)}\n`);
  const exactLineage = proposal.source.lineage.at(-1);
  proposal.source.lineage.pop();
  proposal.review.content_sha256 = proposalContentHash(proposal);
  let variantBytes = Buffer.from(`${JSON.stringify(proposal, null, 2)}\n`);
  fs.writeFileSync(path.join(root, targetRef), variantBytes);
  fs.writeFileSync(
    path.join(root, approvalRef),
    `${JSON.stringify(
      buildApproval(proposal, variantBytes, {
        approvedBy: "user:owner",
        approvedAt: "2026-07-14T01:30:00.000Z",
        decisionId: approvalDecision.id,
        decisionSha256: approvalDecision.sha256,
      }),
      null,
      2
    )}\n`
  );
  assert.throws(() => promote(root, requestValue), /source lineage must bind/);
  proposal.source.lineage.push({ ...exactLineage, sha256: `sha256:${"f".repeat(64)}` });
  proposal.review.content_sha256 = proposalContentHash(proposal);
  variantBytes = Buffer.from(`${JSON.stringify(proposal, null, 2)}\n`);
  fs.writeFileSync(path.join(root, targetRef), variantBytes);
  fs.writeFileSync(
    path.join(root, approvalRef),
    `${JSON.stringify(
      buildApproval(proposal, variantBytes, {
        approvedBy: "user:owner",
        approvedAt: "2026-07-14T01:30:00.000Z",
        decisionId: approvalDecision.id,
        decisionSha256: approvalDecision.sha256,
      }),
      null,
      2
    )}\n`
  );
  assert.throws(() => promote(root, requestValue), /source lineage must bind/);
  proposal.source.lineage[proposal.source.lineage.length - 1] = exactLineage;
  fs.writeFileSync(path.join(root, targetRef), proposalBytes);
  fs.writeFileSync(path.join(root, approvalRef), `${JSON.stringify(approval, null, 2)}\n`);
  assert.throws(
    () => promote(root, { ...requestValue, confirmed_at: "2026-07-13T23:59:59Z" }),
    /cannot precede/
  );
  assert.throws(
    () => promote(root, { ...requestValue, confirmed_at: "2026-07-14T01:15:00Z" }),
    /cannot precede/
  );
  proposal.review = JSON.parse(proposalBytes.toString("utf8")).review;
  proposal.lifecycle = "planned";
  fs.writeFileSync(path.join(root, targetRef), `${JSON.stringify(proposal, null, 2)}\n`);
  result = run(["promote", "--root", root, "--request", requestPath]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /exact current approved proposal bytes/);
  proposal.lifecycle = "approved";
  fs.writeFileSync(path.join(root, targetRef), proposalBytes);

  assert.throws(
    () =>
      promote(root, requestValue, {
        beforeReattest() {
          fs.writeFileSync(path.join(root, approvalRef), "{}\n");
        },
      }),
    /atomic write attestation changed/
  );
  const unpromoted = JSON.parse(fs.readFileSync(path.join(root, decisionPath), "utf8"));
  assert.equal(unpromoted.promotion.status, "not-offered");
  fs.writeFileSync(path.join(root, approvalRef), `${JSON.stringify(approval, null, 2)}\n`);
  result = run(["promote", "--root", root, "--request", requestPath]);
  assert.equal(result.status, 0, result.stderr);
  const promoted = JSON.parse(fs.readFileSync(path.join(root, decisionPath), "utf8"));
  assert.equal(promoted.promotion.status, "promoted");
  assert.equal(promoted.promotion.target_ref, targetRef);
  assert.equal(promoted.source_artifacts[0].path, targetRef);
});

test("promote rejects duplicate binding work before reading artifacts", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-reasoning-duplicate-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const request = path.join(root, "request.json");
  fs.writeFileSync(
    request,
    JSON.stringify({
      decision_path: "missing.json",
      target_ref: "target.json",
      confirmed_at: "2026-07-14T02:00:00Z",
      approval_decision: { id: "decision", sha256: `sha256:${"1".repeat(64)}` },
      binding_paths: ["target.json", "target.json"],
    })
  );
  const result = run(["promote", "--root", root, "--request", request]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must be unique/);
});
