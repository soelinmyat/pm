"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { inspectHtmlArtifact } = require("../scripts/artifact-check.js");
const { renderProposal, main } = require("../scripts/proposal-render.js");
const { check } = require("../scripts/proposal-check.js");
const { reviewRowForTier } = require("./helpers/groom-review-fixture.js");

const FIXTURE = path.join(__dirname, "fixtures", "proposals", "strong-v1.json");

function source() {
  const bytes = fs.readFileSync(FIXTURE);
  return { bytes, proposal: JSON.parse(bytes) };
}

test("proposal renderer is byte-deterministic and binds both projections to canonical source", () => {
  const input = source();
  const options = {
    sourceBytes: input.bytes,
    sourcePath: "pm/backlog/proposals/structured-groom.json",
    version: "test",
  };
  const first = renderProposal(input.proposal, options);
  const second = renderProposal(input.proposal, options);
  assert.equal(first.html, second.html);
  assert.equal(first.markdown, second.markdown);
  assert.match(first.html, new RegExp(first.source_sha256.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(
    first.markdown,
    new RegExp(first.source_sha256.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  );
  assert.match(first.html, /id="decision-brief"/);
  assert.match(first.html, /id="execution-contract"/);
  assert.match(first.html, /id="appendix"/);
  assert.match(first.html, /Critical states/);
  assert.match(first.html, /stale approval/);
  assert.match(first.html, /Lifecycle and approval state remain visible at narrow widths/);
  assert.match(first.html, /class="toc-group"/);
  assert.match(first.html, /<details class="appendix-disclosure" open>/);
  assert.match(first.html, /12 sections · collapse to focus/);
  assert.match(first.html, /12 sections · expand for evidence/);
  assert.match(first.html, /Review must finish before approval/);
  assert.match(first.html, /data-pm-lifecycle href="#decision-action"/);
  assert.match(first.html, /Draft status never implies approval/);
  assert.match(first.html, /Approval applies only to revision <strong>1<\/strong>/);
  assert.match(first.html, /\.masthead \{[\s\S]*position: sticky/);
  assert.match(first.html, /\.masthead-meta \{[\s\S]*grid-template-columns: repeat\(2/);
  assert.match(first.html, /aria-label="Field and Contract"/);
  assert.doesNotMatch(first.html, /approval\.:/i);
  assert.match(first.html, /<strong>Outcome\.<\/strong> Pass/);
  assert.match(first.markdown, /### Critical states/);
  assert.match(first.markdown, /### Visual invariants/);
  assert.match(first.markdown, /Do not edit by hand/);
});

test("canonical projections expose review conclusions, rationales, confidence, evidence locators, and findings", () => {
  const input = source();
  const questionIds = [
    "problem-evidence",
    "scope",
    "acceptance",
    "experience",
    "feasibility",
    "reversal",
  ];
  input.proposal.review_contract = {
    session_id: input.proposal.source.session_id,
    tier: "full",
    required_question_ids: questionIds,
  };
  input.proposal.question_reviews = questionIds.map((questionId, index) =>
    reviewRowForTier("full", questionId, index)
  );
  input.proposal.question_reviews[0] = reviewRowForTier("full", "problem-evidence", 0, {
    outcome: "advisory",
    confidence: "medium",
    finding:
      "Longitudinal renewal behavior remains an unresolved evidence gap for enterprise teams.",
    advisoryDebtIds: ["debt:renewal-gap"],
  });
  input.proposal.advisory_debt = [
    {
      id: "debt:renewal-gap",
      summary: "Validate enterprise renewal behavior after launch.",
      severity: "medium",
      status: "open",
    },
  ];

  const rendered = renderProposal(input.proposal, {
    sourceBytes: Buffer.from(`${JSON.stringify(input.proposal, null, 2)}\n`),
    version: "test",
  });
  for (const projection of [rendered.html, rendered.markdown]) {
    assert.match(projection, /Repeated stale approvals establish a decision-worthy user problem/);
    assert.match(projection, /Two observed approval failures connect changed proposal bytes/);
    assert.match(projection, /evidence:baseline/);
    assert.match(projection, /F1/);
    assert.match(projection, /Medium/);
    assert.match(projection, /Longitudinal renewal behavior remains an unresolved evidence gap/);
  }
});

test("Ideate-origin proposals preserve the v2 companion marker in the generated projection", () => {
  const input = source();
  input.proposal.source.lineage.push({
    id: "source:idea-origin",
    path: "pm/backlog/structured-groom.decision.json",
    sha256: `sha256:${"a".repeat(64)}`,
  });
  const rendered = renderProposal(input.proposal, {
    sourceBytes: Buffer.from(`${JSON.stringify(input.proposal, null, 2)}\n`),
    version: "test",
  });
  assert.match(rendered.markdown, /reasoning_version: 2/);
  assert.match(rendered.markdown, /decision_brief: "backlog\/structured-groom\.decision\.json"/);
});

test("generated proposal reader passes the shared offline artifact contract", () => {
  const input = source();
  const rendered = renderProposal(input.proposal, {
    sourceBytes: input.bytes,
    sourcePath: "pm/backlog/proposals/structured-groom.json",
    version: "test",
  });
  const result = inspectHtmlArtifact(Buffer.from(rendered.html), { expectedKind: "proposal" });
  assert.equal(
    result.ok,
    true,
    result.issues.map((item) => `${item.path}: ${item.message}`).join("\n")
  );
  assert.equal(result.metadata.source.sha256, rendered.source_sha256);
});

test("UI proposals surface their approved prototype without embedding executable content", () => {
  const input = source();
  input.proposal.design_context.prototype = {
    path: "pm/backlog/wireframes/structured-groom.html",
    sha256: `sha256:${"b".repeat(64)}`,
  };
  const rendered = renderProposal(input.proposal, {
    sourceBytes: Buffer.from(`${JSON.stringify(input.proposal, null, 2)}\n`),
    sourcePath: "pm/backlog/proposals/structured-groom.json",
    htmlPath: "pm/backlog/proposals/structured-groom.html",
    version: "test",
  });

  assert.match(rendered.html, /<figure class="hero-prototype"/);
  assert.match(rendered.html, /href="\.\.\/wireframes\/structured-groom\.html"/);
  assert.match(rendered.html, /Bound interaction prototype/);
  assert.match(rendered.html, /draft · reviewed · approved · stale approval/);
  assert.doesNotMatch(rendered.html, /<iframe\b/i);
  assert.doesNotMatch(rendered.html, /<script[^>]+src=/i);
  const inspected = inspectHtmlArtifact(Buffer.from(rendered.html), { expectedKind: "proposal" });
  assert.equal(inspected.ok, true, JSON.stringify(inspected.issues));
});

test("proposal tables carry mobile row labels for a readable stacked layout", () => {
  const input = source();
  const rendered = renderProposal(input.proposal, {
    sourceBytes: input.bytes,
    sourcePath: "pm/backlog/proposals/structured-groom.json",
    version: "test",
  });

  assert.match(rendered.html, /<td data-label="Field">Scope<\/td>/);
  assert.match(
    rendered.html,
    /<td data-label="Contract">A strict proposal schema and checker\.<\/td>/
  );
});

test("post-approval lifecycle readers preserve approval and show the current state", () => {
  for (const lifecycle of ["planned", "in-progress", "done"]) {
    const input = source();
    input.proposal.lifecycle = lifecycle;
    input.proposal.review = {
      status: "passed",
      revision: input.proposal.revision,
      content_sha256: require("../scripts/lib/proposal-schema.js").proposalContentHash(
        input.proposal
      ),
      completed_at: "2026-07-14T02:00:00.000Z",
    };
    const rendered = renderProposal(input.proposal, {
      sourceBytes: Buffer.from(`${JSON.stringify(input.proposal, null, 2)}\n`),
      version: "test",
    });
    assert.match(
      rendered.html,
      new RegExp(`Approved[^<]*.*${lifecycle.replace("-", "[ -]")}`, "i")
    );
    assert.match(rendered.html, /Approval is valid for this exact proposal/);
    assert.match(rendered.html, new RegExp(`/pm:rfc ${input.proposal.slug}`));
    assert.doesNotMatch(rendered.html, /Review must finish before approval/);
  }
});

test("reviewed proposals give the approver one concrete, revision-bound next step", () => {
  const input = source();
  input.proposal.lifecycle = "reviewed";
  const rendered = renderProposal(input.proposal, {
    sourceBytes: Buffer.from(`${JSON.stringify(input.proposal, null, 2)}\n`),
    version: "test",
  });

  assert.match(rendered.html, /Your approval is the next step/);
  assert.match(rendered.html, /Approve this proposal for technical design/);
  assert.match(rendered.html, new RegExp(`/pm:groom ${input.proposal.slug}`));
  assert.match(rendered.html, /Any substantive edit makes that approval stale/);
});

test("CLI atomically writes canonical HTML and Markdown locations", () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "proposal-render-"));
  try {
    const proposalDir = path.join(project, "pm", "backlog", "proposals");
    fs.mkdirSync(proposalDir, { recursive: true });
    const proposalPath = path.join(proposalDir, "structured-groom.json");
    fs.copyFileSync(FIXTURE, proposalPath);
    assert.equal(main(["--proposal", proposalPath, "--project-root", project, "--json"]), 0);
    assert.ok(fs.existsSync(path.join(proposalDir, "structured-groom.html")));
    assert.ok(fs.existsSync(path.join(project, "pm", "backlog", "structured-groom.md")));
    const verified = check({ proposal: proposalPath, projectRoot: project, projections: true });
    assert.equal(verified.ok, true, verified.issues?.map((item) => item.message).join("\n"));
    assert.equal(verified.projections_verified, true);
    fs.appendFileSync(
      path.join(project, "pm", "backlog", "structured-groom.md"),
      "\nmanual drift\n"
    );
    const drifted = check({ proposal: proposalPath, projectRoot: project, projections: true });
    assert.equal(drifted.ok, false);
    assert.match(drifted.issues.map((item) => item.message).join("\n"), /Markdown/);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});
