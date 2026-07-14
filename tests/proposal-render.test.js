"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { inspectHtmlArtifact } = require("../scripts/artifact-check.js");
const { renderProposal, main } = require("../scripts/proposal-render.js");
const { check } = require("../scripts/proposal-check.js");

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
  assert.match(first.markdown, /Do not edit by hand/);
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
    assert.match(rendered.html, /Product approval remains valid/);
    assert.doesNotMatch(rendered.html, /Approval is still required/);
  }
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
