"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { inspectHtmlArtifact } = require("../scripts/artifact-check.js");
const {
  renderArtifact: renderArtifactInBrowser,
  resolveBrowser,
  runBrowserProbe,
} = require("../scripts/artifact-render-check.js");
const { renderProposal, main } = require("../scripts/proposal-render.js");
const { check } = require("../scripts/proposal-check.js");
const {
  buildApproval,
  deriveApprovalDecision,
  proposalContentHash,
} = require("../scripts/lib/proposal-schema.js");
const {
  bindCurrentReviewContract,
  materializeProposalSources,
  reviewRowForTier,
} = require("./helpers/groom-review-fixture.js");

const FIXTURE = path.join(__dirname, "fixtures", "proposals", "strong-v1.json");
let installedBrowser = null;
try {
  installedBrowser = resolveBrowser();
} catch {
  installedBrowser = null;
}

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
  assert.match(first.html, /UI impact/);
  assert.match(first.html, /Visual UI change/);
  assert.match(first.html, /Critical states/);
  assert.match(
    first.html,
    /Reviewers can identify the current decision state before inspecting implementation detail\./
  );
  assert.match(first.html, /Evidence provenance/);
  assert.match(first.html, /Observed\.<\/strong> 2026-07-14T01:00:00\.000Z/);
  assert.match(first.html, /Source lineage/);
  assert.match(first.html, /<table class="source-lineage" data-responsive="true"/);
  assert.match(first.html, /\.source-lineage td:last-child\s*\{[^}]*font-family:\s*var\(--mono\)/s);
  assert.match(
    first.html,
    /\.source-lineage th:nth-child\(3\), \.source-lineage td:nth-child\(3\)\s*\{\s*width:\s*42%/s
  );
  assert.match(
    first.html,
    /sha256:1111111111111111111111111111111111111111111111111111111111111111/
  );
  assert.match(first.html, /stale approval/);
  assert.match(first.html, /Lifecycle and approval state remain visible at narrow widths/);
  assert.match(first.html, /class="toc-group"/);
  assert.match(first.html, /<details class="appendix-disclosure" open>/);
  assert.match(first.html, /12 sections · collapse to focus/);
  assert.match(first.html, /12 sections · expand for evidence/);
  assert.match(first.html, /Review must finish before approval/);
  assert.ok(first.html.indexOf('id="decision-action"') < first.html.indexOf('class="tldr"'));
  assert.doesNotMatch(first.html, /\.closing\b|class="closing"/);
  assert.match(
    first.html,
    /Proposal <strong>Draft<\/strong>[\s\S]*Review <strong>Pending<\/strong>[\s\S]*Approval <strong>Blocked<\/strong>/
  );
  assert.match(first.html, /data-pm-lifecycle href="#decision-action"/);
  assert.match(first.html, /Draft status never implies approval/);
  assert.match(first.html, /Approval applies only to revision <strong>1<\/strong>/);
  assert.match(
    first.html,
    /title="Full content identity: sha256:[a-f0-9]{64}">sha256:[a-f0-9]{8}…[a-f0-9]{8}<\/code>/
  );
  assert.match(first.html, /\.masthead \{[\s\S]*position: sticky/);
  assert.match(first.html, /\.masthead-meta \{[\s\S]*grid-template-columns: repeat\(2/);
  assert.match(first.html, /aria-label="Field and Contract"/);
  assert.match(first.html, /<span class="toc-num" aria-hidden="true">I<\/span>Problem/);
  assert.match(first.html, /<span class="sec-num" aria-hidden="true">00<\/span>Decision Brief/);
  assert.match(first.html, /\.toc-num\s*\{[^}]*color:\s*var\(--ink-2\)/s);
  assert.match(first.html, /code\s*\{[^}]*overflow-wrap:\s*anywhere;[^}]*word-break:\s*normal;/s);
  assert.match(first.html, /@media print \{ \.skip-link \{ display: none !important; \} \}/);
  assert.doesNotMatch(first.html, /approval\.:/i);
  assert.match(first.html, /<strong>Question result\.<\/strong> Pass/);
  assert.match(first.markdown, /\*\*Question result:\*\* Pass/);
  assert.match(first.markdown, /### Critical states/);
  assert.match(first.markdown, /### UI impact/);
  assert.match(first.markdown, /Visual UI change/);
  assert.match(first.markdown, /### Experience invariants/);
  assert.match(
    first.markdown,
    /Reviewers can identify the current decision state before inspecting implementation detail\./
  );
  assert.match(first.markdown, /### Visual invariants/);
  assert.match(first.markdown, /## Evidence & provenance/);
  assert.match(first.markdown, /Observed: 2026-07-14T01:00:00\.000Z/);
  assert.match(first.markdown, /### Source lineage/);
  assert.match(first.markdown, /source:research/);
  assert.match(
    first.markdown,
    /sha256:1111111111111111111111111111111111111111111111111111111111111111/
  );
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

test(
  "generated proposal reader has no horizontal overflow at canonical viewports",
  { skip: !installedBrowser && "Chromium is not installed" },
  () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "proposal-render-browser-"));
    try {
      const input = source();
      const rendered = renderProposal(input.proposal, {
        sourceBytes: input.bytes,
        sourcePath: "pm/backlog/proposals/structured-groom.json",
        version: "test",
      });
      const htmlPath = path.join(root, "structured-groom.html");
      fs.writeFileSync(htmlPath, rendered.html);
      const result = renderArtifactInBrowser({
        htmlPath,
        outputDir: path.join(root, "renders"),
        browserPath: installedBrowser,
        projectRoot: root,
      });
      assert.ok(result.captures.every((capture) => !capture.metrics.horizontalOverflow));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
);

test(
  "execution-contract cells use the full row width at the narrow viewport",
  { skip: !installedBrowser && "Chromium is not installed" },
  () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "proposal-execution-contract-browser-"));
    try {
      const input = source();
      const rendered = renderProposal(input.proposal, {
        sourceBytes: input.bytes,
        sourcePath: "pm/backlog/proposals/structured-groom.json",
        version: "test",
      });
      const htmlPath = path.join(root, "structured-groom.html");
      fs.writeFileSync(htmlPath, rendered.html);
      const result = runBrowserProbe(
        {
          browserPath: installedBrowser,
          htmlPath,
          viewport: { width: 375, height: 812 },
          expression: `(() => {
            const rows = [...document.querySelectorAll("#execution-contract tbody tr")];
            return rows.map((row) => ({
              rowWidth: row.getBoundingClientRect().width,
              cells: [...row.querySelectorAll("td")].map((cell) => ({
                display: getComputedStyle(cell).display,
                gridTemplateColumns: getComputedStyle(cell).gridTemplateColumns,
                beforeDisplay: getComputedStyle(cell, "::before").display,
                width: cell.getBoundingClientRect().width,
              })),
            }));
          })()`,
        },
        "narrow execution-contract layout probe"
      );
      const rows = JSON.parse(result.stdout);
      assert.ok(rows.length > 0);
      for (const row of rows) {
        assert.equal(row.cells.length, 2);
        for (const cell of row.cells) {
          assert.equal(cell.display, "block");
          assert.equal(cell.gridTemplateColumns, "none");
          assert.equal(cell.beforeDisplay, "none");
          assert.ok(cell.width >= row.rowWidth - 1);
        }
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
);

test("UI proposals surface their bound prototype without embedding executable content", () => {
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
  assert.match(rendered.html, /Open the bound flow and inspect every critical state/);
  assert.doesNotMatch(rendered.html, /Open the approved flow/);
  assert.match(rendered.html, /draft · reviewed · approved · stale approval/);
  assert.doesNotMatch(rendered.html, /<iframe\b/i);
  assert.doesNotMatch(rendered.html, /<script[^>]+src=/i);
  const inspected = inspectHtmlArtifact(Buffer.from(rendered.html), { expectedKind: "proposal" });
  assert.equal(inspected.ok, true, JSON.stringify(inspected.issues));
});

test("prototype hero copy stays accurate across draft, reviewed, and verified approved states", () => {
  for (const lifecycle of ["draft", "reviewed"]) {
    const input = source();
    input.proposal.lifecycle = lifecycle;
    input.proposal.design_context.prototype = {
      path: "pm/backlog/wireframes/structured-groom.html",
      sha256: `sha256:${"b".repeat(64)}`,
    };
    const rendered = renderProposal(input.proposal, {
      sourceBytes: Buffer.from(`${JSON.stringify(input.proposal, null, 2)}\n`),
      version: "test",
    });
    assert.match(rendered.html, /Open the bound flow and inspect every critical state/);
    assert.doesNotMatch(rendered.html, /Open the approved flow/);
  }

  const approved = source();
  approved.proposal.lifecycle = "approved";
  approved.proposal.design_context.prototype = {
    path: "pm/backlog/wireframes/structured-groom.html",
    sha256: `sha256:${"b".repeat(64)}`,
  };
  const sourceBytes = Buffer.from(`${JSON.stringify(approved.proposal, null, 2)}\n`);
  const unverified = renderProposal(approved.proposal, { sourceBytes, version: "test" });
  const verified = renderProposal(approved.proposal, {
    sourceBytes,
    version: "test",
    actuallyVerifiedApproval: {
      trustedApproval: true,
      approval: {
        revision: approved.proposal.revision,
        content_sha256: unverified.content_sha256,
      },
    },
  });
  assert.match(verified.html, /Open the bound flow and inspect every critical state/);
  assert.doesNotMatch(verified.html, /Open the approved flow/);
  assert.match(verified.html, /Approval verified; current lifecycle approved/);
});

test("multi-file prototype projections expose the complete bound tree identity", () => {
  const input = source();
  const treeSha256 = `sha256:${"c".repeat(64)}`;
  input.proposal.design_context.prototype = {
    path: "pm/backlog/wireframes/structured-groom/index.html",
    sha256: `sha256:${"b".repeat(64)}`,
    manifest: {
      schema_version: 1,
      files: [
        { path: "base.css", sha256: `sha256:${"1".repeat(64)}` },
        { path: "index.html", sha256: `sha256:${"2".repeat(64)}` },
        { path: "meta.json", sha256: `sha256:${"3".repeat(64)}` },
        { path: "screens/review.html", sha256: `sha256:${"4".repeat(64)}` },
      ],
      tree_sha256: treeSha256,
    },
  };

  const rendered = renderProposal(input.proposal, {
    sourceBytes: Buffer.from(`${JSON.stringify(input.proposal, null, 2)}\n`),
    version: "test",
  });

  for (const projection of [rendered.html, rendered.markdown]) {
    assert.match(projection, new RegExp(treeSha256));
    assert.match(projection, /4 bound files/);
    assert.match(projection, /screens\/review\.html/);
    assert.match(
      projection,
      /sha256:4444444444444444444444444444444444444444444444444444444444444444/
    );
  }
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

test("post-approval lifecycle never claims verification without a supplied verified state", () => {
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
    assert.doesNotMatch(rendered.html, /Approval is valid for this exact proposal/);
    assert.doesNotMatch(rendered.html, /Approval verified/);
    assert.match(rendered.html, /verified approval state was not supplied to this renderer/i);
    assert.match(rendered.markdown, /verified approval state was not supplied to this renderer/i);
    assert.doesNotMatch(rendered.html, /Review must finish before approval/);

    const verified = renderProposal(input.proposal, {
      sourceBytes: Buffer.from(`${JSON.stringify(input.proposal, null, 2)}\n`),
      version: "test",
      actuallyVerifiedApproval: {
        trustedApproval: true,
        approval: {
          revision: input.proposal.revision,
          content_sha256: rendered.content_sha256,
        },
      },
    });
    assert.match(verified.html, /Approval is valid for this exact proposal/);
    assert.match(verified.html, /Approval verified/);
    assert.match(verified.html, new RegExp(`/pm:rfc ${input.proposal.slug}`));
    assert.match(verified.markdown, /Approval audit: \*\*verified for this exact proposal\*\*/i);

    const staleApproval = renderProposal(input.proposal, {
      sourceBytes: Buffer.from(`${JSON.stringify(input.proposal, null, 2)}\n`),
      version: "test",
      actuallyVerifiedApproval: {
        trustedApproval: true,
        approval: {
          revision: input.proposal.revision,
          content_sha256: `sha256:${"f".repeat(64)}`,
        },
      },
    });
    assert.doesNotMatch(staleApproval.html, /Approval verified/);
    assert.match(staleApproval.html, /verified approval state was not supplied/i);
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

test("decision action titles are semantic headings across proposal lifecycle states", () => {
  const cases = [
    ["draft", "Review must finish before approval"],
    ["reviewed", "Your approval is the next step"],
    ["approved", "Lifecycle is approved; approval verification is not shown"],
  ];

  for (const [lifecycle, title] of cases) {
    const input = source();
    input.proposal.lifecycle = lifecycle;
    const rendered = renderProposal(input.proposal, {
      sourceBytes: Buffer.from(`${JSON.stringify(input.proposal, null, 2)}\n`),
      version: "test",
    });

    assert.ok(rendered.html.includes(`<h2 class="decision-action-title">${title}</h2>`));
    assert.doesNotMatch(rendered.html, /<div class="decision-action-title">/);
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

test("CLI and projection checker agree on a canonically verified approval audit", () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "proposal-render-approved-"));
  try {
    const input = source();
    bindCurrentReviewContract(input.proposal);
    materializeProposalSources(project, input.proposal);
    input.proposal.lifecycle = "approved";
    input.proposal.review = {
      status: "passed",
      revision: input.proposal.revision,
      content_sha256: proposalContentHash(input.proposal),
      completed_at: "2026-07-14T02:00:00.000Z",
    };
    const proposalDir = path.join(project, "pm", "backlog", "proposals");
    const proposalPath = path.join(proposalDir, "structured-groom.json");
    const approvalPath = proposalPath.replace(/\.json$/, ".approval.json");
    fs.mkdirSync(proposalDir, { recursive: true });
    fs.writeFileSync(proposalPath, `${JSON.stringify(input.proposal, null, 2)}\n`);
    const approvalInput = {
      approvedBy: "user:owner",
      approvedAt: "2026-07-14T03:00:00.000Z",
    };
    const decision = deriveApprovalDecision(input.proposal, approvalInput);
    const approval = buildApproval(input.proposal, fs.readFileSync(proposalPath), {
      ...approvalInput,
      decisionId: decision.id,
      decisionSha256: decision.sha256,
    });
    fs.writeFileSync(approvalPath, `${JSON.stringify(approval, null, 2)}\n`);

    assert.equal(main(["--proposal", proposalPath, "--project-root", project, "--json"]), 0);
    const html = fs.readFileSync(path.join(proposalDir, "structured-groom.html"), "utf8");
    const markdown = fs.readFileSync(
      path.join(project, "pm", "backlog", "structured-groom.md"),
      "utf8"
    );
    assert.match(html, /Approval verified/);
    assert.match(html, /Approval is valid for this exact proposal/);
    assert.match(markdown, /Approval audit: \*\*verified for this exact proposal\*\*/i);

    const verified = check({ proposal: proposalPath, projectRoot: project, projections: true });
    assert.equal(verified.ok, true, verified.issues?.map((item) => item.message).join("\n"));
    assert.equal(verified.approval_verified, true);
    assert.equal(verified.projections_verified, true);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});
