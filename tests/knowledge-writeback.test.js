"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const { writeKnowledgeArtifact, normalizePayload } = require("../scripts/knowledge-writeback.js");

const VALIDATE_SCRIPT = path.join(__dirname, "..", "scripts", "validate.js");
const WRITEBACK_SCRIPT = path.join(__dirname, "..", "scripts", "knowledge-writeback.js");

function createPmDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-writeback-"));
  const pmDir = path.join(root, "pm");
  fs.mkdirSync(pmDir, { recursive: true });
  return {
    pmDir,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function runValidate(pmDir) {
  try {
    return JSON.parse(
      execFileSync("node", [VALIDATE_SCRIPT, "--dir", pmDir], { encoding: "utf8" })
    );
  } catch (error) {
    return JSON.parse(error.stdout);
  }
}

function seedLinkedInsight(
  pmDir,
  {
    insightPath,
    sourcePath,
    topic = "Existing Topic",
    body = "Linked for validation fixture coverage.",
  }
) {
  const absolutePath = path.join(pmDir, insightPath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(
    absolutePath,
    [
      "---",
      "type: insight",
      `domain: ${insightPath.includes("/business/") ? "business" : "product"}`,
      `topic: "${topic}"`,
      "last_updated: 2026-04-05",
      "status: draft",
      "confidence: low",
      "sources:",
      `  - "${sourcePath}"`,
      "---",
      "",
      `# ${topic}`,
      "",
      "## Synthesis",
      body,
      "",
    ].join("\n")
  );
}

function seedEvidence(pmDir, { evidencePath, topic = "Existing Evidence", citedBy = [] }) {
  const absolutePath = path.join(pmDir, evidencePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(
    absolutePath,
    [
      "---",
      "type: evidence",
      "evidence_type: research",
      `topic: "${topic}"`,
      "source_origin: internal",
      "created: 2026-04-01",
      "updated: 2026-04-05",
      "sources: []",
      citedBy.length > 0 ? "cited_by:" : "cited_by: []",
      ...citedBy.map((item) => `  - "${item}"`),
      "---",
      "",
      `# ${topic}`,
      "",
      "## Summary",
      "Existing evidence fixture.",
      "",
    ].join("\n")
  );
}

test("normalizePayload requires topic, summary, findings, and research path", () => {
  assert.throws(
    () =>
      normalizePayload({
        artifactPath: "evidence/research/test.md",
        summary: "x",
        findings: ["a"],
      }),
    /topic is required/
  );
  assert.throws(
    () =>
      normalizePayload({
        artifactPath: "evidence/research/test.md",
        topic: "Test",
        findings: ["a"],
      }),
    /summary is required/
  );
  assert.throws(
    () =>
      normalizePayload({
        artifactPath: "evidence/research/test.md",
        topic: "Test",
        summary: "x",
        findings: [],
      }),
    /findings must contain at least one item/
  );
  assert.throws(
    () =>
      normalizePayload({
        artifactPath: "insights/product/test.md",
        topic: "Test",
        summary: "x",
        findings: ["a"],
      }),
    /artifactPath must stay under evidence\/research/
  );
});

test("writeKnowledgeArtifact creates a new internal evidence file plus research index/log", () => {
  const { pmDir, cleanup } = createPmDir();
  try {
    seedEvidence(pmDir, {
      evidencePath: "evidence/research/existing-linked.md",
      topic: "Retry State Research",
      citedBy: ["insights/product/retry-product-rule.md"],
    });
    fs.writeFileSync(
      path.join(pmDir, "evidence", "research", "index.md"),
      [
        "# Index",
        "",
        "| Topic/Source | Description | Updated | Status |",
        "|---|---|---|---|",
        "| [existing-linked.md](existing-linked.md) | Retry state research | 2026-04-05 | internal |",
        "",
      ].join("\n")
    );
    fs.writeFileSync(
      path.join(pmDir, "evidence", "research", "log.md"),
      "2026-04-05 create evidence/research/existing-linked.md\n"
    );
    seedLinkedInsight(pmDir, {
      insightPath: "insights/product/retry-product-rule.md",
      sourcePath: "evidence/research/existing-linked.md",
      topic: "Retry Product Rule",
      body: "Retry-state product rules shape checkout reliability and recovery behavior.",
    });
    const result = writeKnowledgeArtifact(pmDir, {
      artifactPath: "evidence/research/test-implementation-learnings.md",
      topic: "Test Implementation Learnings",
      summary: "Implementation exposed a missing product rule.",
      findings: [
        "QA found a user-visible edge case around draft persistence.",
        "The current acceptance criteria omit retry behavior after network failure.",
      ],
      strategicRelevance: "Future grooming should include retry-state behavior explicitly.",
      implications: ["Update related backlog items to specify retry states."],
      openQuestions: ["Should retry behavior be standardized across flows?"],
      description: "Implementation learnings from delivery and QA",
      artifactMode: "implementation-learnings",
      sourceArtifacts: ["backlog/test-item.md", ".pm/dev-sessions/test-item.md"],
    });

    assert.equal(result.artifactPath, "evidence/research/test-implementation-learnings.md");
    assert.equal(result.created, true);

    const artifactPath = path.join(
      pmDir,
      "evidence",
      "research",
      "test-implementation-learnings.md"
    );
    const content = fs.readFileSync(artifactPath, "utf8");
    assert.match(content, /type: "evidence"/);
    assert.match(content, /evidence_type: "research"/);
    assert.match(content, /source_origin: "internal"/);
    assert.match(content, /## Findings/);
    assert.match(content, /## Source Artifacts/);

    const indexContent = fs.readFileSync(
      path.join(pmDir, "evidence", "research", "index.md"),
      "utf8"
    );
    assert.match(
      indexContent,
      /\[test-implementation-learnings\.md\]\(test-implementation-learnings\.md\)/
    );
    assert.match(indexContent, /Implementation learnings from delivery and QA/);
    assert.match(indexContent, /\| internal \|/);

    const logContent = fs.readFileSync(path.join(pmDir, "evidence", "research", "log.md"), "utf8");
    assert.match(logContent, /create evidence\/research\/test-implementation-learnings\.md/);
    assert.ok(Array.isArray(result.routeSuggestions.suggestions));
    assert.equal(
      result.routeSuggestions.suggestions[0].insightPath,
      "insights/product/retry-product-rule.md"
    );

    const validation = runValidate(pmDir);
    assert.equal(validation.ok, true);
  } finally {
    cleanup();
  }
});

test("knowledge-writeback CLI accepts stdin JSON payloads", () => {
  const { pmDir, cleanup } = createPmDir();
  try {
    const stdout = execFileSync("node", [WRITEBACK_SCRIPT, "--pm-dir", pmDir], {
      input: JSON.stringify({
        artifactPath: "evidence/research/cli-writeback.md",
        topic: "CLI Writeback",
        summary: "The CLI path should be stable for workflow use.",
        findings: ["The helper accepts JSON over stdin and writes deterministically."],
        description: "CLI writeback smoke test",
      }),
      encoding: "utf8",
    });

    const result = JSON.parse(stdout);
    assert.equal(result.artifactPath, "evidence/research/cli-writeback.md");
    assert.ok(Array.isArray(result.routeSuggestions.suggestions));

    const artifactPath = path.join(pmDir, "evidence", "research", "cli-writeback.md");
    assert.equal(fs.existsSync(artifactPath), true);

    const validation = runValidate(pmDir);
    assert.equal(validation.ok, true);
  } finally {
    cleanup();
  }
});

test("writeKnowledgeArtifact updates an existing file while preserving created date and cited_by", () => {
  const { pmDir, cleanup } = createPmDir();
  try {
    const researchDir = path.join(pmDir, "evidence", "research");
    fs.mkdirSync(researchDir, { recursive: true });
    fs.writeFileSync(
      path.join(researchDir, "existing-decisions.md"),
      [
        "---",
        "type: evidence",
        "evidence_type: research",
        'topic: "Existing Decisions"',
        "source_origin: internal",
        "created: 2026-04-01",
        "updated: 2026-04-05",
        "sources: []",
        "cited_by:",
        '  - "insights/product/existing-topic.md"',
        "---",
        "",
        "# Existing Decisions",
        "",
        "## Summary",
        "Old summary.",
      ].join("\n")
    );
    fs.writeFileSync(
      path.join(researchDir, "index.md"),
      [
        "# Index",
        "",
        "| Topic/Source | Description | Updated | Status |",
        "|---|---|---|---|",
        "| [existing-decisions.md](existing-decisions.md) | Old description | 2026-04-05 | internal |",
        "",
      ].join("\n")
    );
    fs.writeFileSync(
      path.join(researchDir, "log.md"),
      "2026-04-05 create evidence/research/existing-decisions.md\n"
    );
    seedLinkedInsight(pmDir, {
      insightPath: "insights/product/existing-topic.md",
      sourcePath: "evidence/research/existing-decisions.md",
      topic: "Existing Topic",
    });

    const result = writeKnowledgeArtifact(pmDir, {
      artifactPath: "evidence/research/existing-decisions.md",
      topic: "Existing Decisions",
      summary: "The groom cycle clarified the tradeoff behind the approved scope.",
      findings: ["A narrower scope avoided a repeated configuration branch."],
      strategicRelevance: "Future proposals in this area should preserve the narrower baseline.",
      implications: ["Carry the tradeoff note into related backlog work."],
      openQuestions: [],
      description: "Updated groom decision record",
      artifactMode: "decision-record",
    });

    assert.equal(result.created, false);
    assert.equal(result.createdDate, "2026-04-01");
    assert.ok(result.routeSuggestions);

    const artifactPath = path.join(researchDir, "existing-decisions.md");
    const content = fs.readFileSync(artifactPath, "utf8");
    assert.match(content, /created: "?2026-04-01"?/);
    assert.match(content, /cited_by:\n {2}- "insights\/product\/existing-topic\.md"/);
    assert.match(content, /The groom cycle clarified the tradeoff/);

    const indexContent = fs.readFileSync(path.join(researchDir, "index.md"), "utf8");
    assert.match(indexContent, /Updated groom decision record/);
    assert.equal((indexContent.match(/existing-decisions\.md/g) || []).length >= 1, true);

    const logContent = fs.readFileSync(path.join(researchDir, "log.md"), "utf8");
    assert.match(logContent, /update evidence\/research\/existing-decisions\.md/);

    const validation = runValidate(pmDir);
    assert.equal(validation.ok, true);
  } finally {
    cleanup();
  }
});

test("writeKnowledgeArtifact promotes internal evidence to mixed when adding external research", () => {
  const { pmDir, cleanup } = createPmDir();
  try {
    const researchDir = path.join(pmDir, "evidence", "research");
    fs.mkdirSync(researchDir, { recursive: true });
    fs.writeFileSync(
      path.join(researchDir, "mixed-provenance.md"),
      [
        "---",
        "type: evidence",
        "evidence_type: research",
        'topic: "Mixed Provenance"',
        "source_origin: internal",
        "created: 2026-04-01",
        "updated: 2026-04-05",
        "sources: []",
        "cited_by: []",
        "---",
        "",
        "# Mixed Provenance",
        "",
        "## Summary",
        "Old summary.",
      ].join("\n")
    );
    fs.writeFileSync(
      path.join(researchDir, "index.md"),
      [
        "# Index",
        "",
        "| Topic/Source | Description | Updated | Status |",
        "|---|---|---|---|",
        "| [mixed-provenance.md](mixed-provenance.md) | Old description | 2026-04-05 | internal |",
        "",
      ].join("\n")
    );
    fs.writeFileSync(
      path.join(researchDir, "log.md"),
      "2026-04-05 create evidence/research/mixed-provenance.md\n"
    );

    writeKnowledgeArtifact(pmDir, {
      artifactPath: "evidence/research/mixed-provenance.md",
      topic: "Mixed Provenance",
      summary: "External research extended an internal note.",
      findings: ["The new research adds outside validation for the earlier internal call."],
      description: "Updated provenance",
      sourceOrigin: "external",
    });

    const content = fs.readFileSync(path.join(researchDir, "mixed-provenance.md"), "utf8");
    assert.match(content, /source_origin: "mixed"/);
  } finally {
    cleanup();
  }
});

test("writeback preserves mixed-origin judgments, custom sections, and v2 bindings", (t) => {
  const { pmDir, cleanup } = createPmDir();
  t.after(cleanup);
  const {
    createEvidenceRecord,
    emptyEvidenceLedger,
    registerEvidence,
  } = require("../scripts/lib/evidence-schema");
  const artifactPath = "evidence/research/navigation.md";
  let ledger = emptyEvidenceLedger("2026-04-01T00:00:00.000Z");
  const records = ["Manager cannot find Time off", "Administrator finds it readily"].map(
    (content, index) => {
      const record = createEvidenceRecord(
        {
          source_type: "feedback",
          source_label: `observation-${index}.md`,
          locator: "section:experience",
          source_format: "md",
          captured_at: "2026-04-01T00:00:00.000Z",
          content,
          privacy: { classification: "internal", pii_review: "not-required" },
          transformation: { stage: "captured", parents: [], method: "test" },
          artifact_path: artifactPath,
        },
        { now: "2026-04-01T00:00:00.000Z" }
      );
      ledger = registerEvidence(ledger, record, { now: "2026-04-01T00:00:00.000Z" }).ledger;
      return record;
    }
  );
  const absolutePath = path.join(pmDir, artifactPath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(path.join(pmDir, "evidence/provenance.json"), JSON.stringify(ledger));
  const manager = `[internal] One manager failed to find Time off. [evidence:${records[0].evidence_id}]`;
  fs.writeFileSync(
    absolutePath,
    `---\ntype: evidence\nevidence_type: research\ntopic: Navigation\nsource_origin: mixed\ncreated: 2026-04-01\nupdated: 2026-04-01\nprovenance_version: 2\nconfidence: low\nsegments:\n  - managers\nsources:\n  - url: https://example.test/study\n    accessed: 2026-04-01\ncited_by: []\n---\n\n# Navigation\n\n## Summary\nDiscovery varies by role.\n\n## Findings\n1. ${manager}\n\n## Representative Quotes\n> I could not locate the destination.\n\n## Open Questions\nHow common is this for occasional users?\n\n## Domain Constraint\nRetain team context on return.\n`
  );
  const administrator = `[internal] One administrator found the destination readily. [evidence:${records[1].evidence_id}]`;
  writeKnowledgeArtifact(pmDir, {
    artifactPath,
    topic: "Navigation",
    summary: "A contrary observation bounds the claim.",
    findings: [administrator],
    sources: [{ url: "https://example.test/contrary", accessed: "2026-04-02" }],
  });
  const content = fs.readFileSync(absolutePath, "utf8");
  assert.match(content, /provenance_version: 2/);
  assert.match(content, /confidence: low/);
  assert.match(content, /segments:\n {2}- managers/);
  assert.match(content, /url: "?https:\/\/example.test\/study"?/);
  assert.match(content, /url: "https:\/\/example.test\/contrary"/);
  assert.doesNotMatch(content, /- None\./);
  assert.ok(content.includes(manager));
  assert.ok(content.includes(administrator));
  assert.match(content, /How common is this for occasional users/);
  assert.match(content, /Retain team context on return/);
  assert.match(content, /I could not locate the destination/);
  assert.match(content, /Discovery varies by role/);
  writeKnowledgeArtifact(pmDir, {
    artifactPath,
    topic: "Navigation",
    summary: "A contrary observation bounds the claim.",
    findings: [administrator],
    sources: [{ url: "https://example.test/contrary", accessed: "2026-04-02" }],
  });
  assert.equal(fs.readFileSync(absolutePath, "utf8").split(administrator).length - 1, 1);
  const { applyRoutes } = require("../scripts/insight-routing.js");
  const routeResult = applyRoutes(
    pmDir,
    {
      routes: [
        {
          mode: "new",
          evidencePath: artifactPath,
          insightPath: "insights/product/navigation.md",
          domain: "product",
          topic: "Navigation",
          description: "Role-specific discoverability",
          selected_findings: [manager],
        },
      ],
    },
    { skipHotIndex: true }
  );
  assert.equal(routeResult.routes[0].action, "created");
  const before = fs.readFileSync(absolutePath, "utf8");
  assert.match(before, /provenance_version: "2"/);
  const logBefore = fs.readFileSync(path.join(pmDir, "evidence/research/log.md"), "utf8");
  assert.throws(
    () =>
      writeKnowledgeArtifact(pmDir, {
        artifactPath,
        topic: "Navigation",
        summary: "Unsupported update",
        findings: ["Most managers cannot find it."],
      }),
    /missing an evidence citation/
  );
  assert.equal(fs.readFileSync(absolutePath, "utf8"), before);
  assert.equal(fs.readFileSync(path.join(pmDir, "evidence/research/log.md"), "utf8"), logBefore);
});

test("supersession records the corrected interpretation and rejects another origin", (t) => {
  const { pmDir, cleanup } = createPmDir();
  t.after(cleanup);
  const artifactPath = "evidence/research/availability.md";
  const base = {
    artifactPath,
    topic: "Availability",
    summary: "Capability observations",
    findings: ["[internal] Import works only for CSV."],
  };
  writeKnowledgeArtifact(pmDir, base);
  writeKnowledgeArtifact(pmDir, {
    ...base,
    findings: ["[external] Public documentation describes JSON import."],
    sourceOrigin: "external",
  });
  const absolutePath = path.join(pmDir, artifactPath);
  const before = fs.readFileSync(absolutePath, "utf8");
  assert.throws(
    () =>
      writeKnowledgeArtifact(pmDir, {
        ...base,
        supersedes: [
          {
            finding: "[external] Public documentation describes JSON import.",
            replacement: "[internal] JSON unavailable.",
            reason: "Local assumption",
          },
        ],
      }),
    /another origin/
  );
  assert.equal(fs.readFileSync(absolutePath, "utf8"), before);
  writeKnowledgeArtifact(pmDir, {
    ...base,
    findings: ["[internal] JSON import now works."],
    supersedes: [
      {
        finding: base.findings[0],
        replacement: "[internal] JSON import now works.",
        reason: "Verified supported runtime after release.",
      },
    ],
  });
  const content = fs.readFileSync(absolutePath, "utf8");
  const findings = content.split("## Findings")[1].split("## ")[0];
  assert.doesNotMatch(findings, /Import works only for CSV/);
  assert.match(findings, /Public documentation describes JSON import/);
  assert.match(content, /## Superseded Findings/);
  assert.match(content, /Superseded: \[internal\] Import works only for CSV/);
  assert.match(content, /Reason: Verified supported runtime after release/);
});

test("legacy ownership survives becoming mixed and enables a supported correction", (t) => {
  const { pmDir, cleanup } = createPmDir();
  t.after(cleanup);
  const artifactPath = "evidence/research/ownership.md";
  const base = {
    artifactPath,
    topic: "Import support",
    summary: "Local import behavior",
    findings: ["CSV imports preserve row order."],
  };
  writeKnowledgeArtifact(pmDir, base);
  writeKnowledgeArtifact(pmDir, {
    ...base,
    sourceOrigin: "external",
    findings: ["Public docs promise JSON support."],
  });
  const absolutePath = path.join(pmDir, artifactPath);
  let content = fs.readFileSync(absolutePath, "utf8");
  assert.match(content, /\[internal\] CSV imports preserve row order/);
  assert.match(content, /\[external\] Public docs promise JSON support/);
  assert.match(
    fs.readFileSync(path.join(pmDir, "evidence/research/index.md"), "utf8"),
    /\| mixed \|/
  );
  writeKnowledgeArtifact(pmDir, {
    ...base,
    findings: ["[internal] CSV order depends on sort mode."],
    supersedes: [
      {
        finding: "[internal] CSV imports preserve row order.",
        replacement: "[internal] CSV order depends on sort mode.",
        reason: "Verified explicit sort behavior.",
      },
    ],
  });
  content = fs.readFileSync(absolutePath, "utf8");
  assert.match(content, /\[external\] Public docs promise JSON support/);
  assert.match(content, /Reason: Verified explicit sort behavior/);
});

test("quoted v2 markers cannot bypass citation enforcement", (t) => {
  const { pmDir, cleanup } = createPmDir();
  t.after(cleanup);
  const { emptyEvidenceLedger } = require("../scripts/lib/evidence-schema");
  const artifactPath = "evidence/research/quoted.md";
  const absolutePath = path.join(pmDir, artifactPath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(
    path.join(pmDir, "evidence/provenance.json"),
    JSON.stringify(emptyEvidenceLedger("2026-04-01T00:00:00.000Z"))
  );
  for (const marker of ['"2"', "'2'"]) {
    const before = `---\ntype: evidence\nevidence_type: research\ntopic: Quoted\nsource_origin: internal\nprovenance_version: ${marker}\ncreated: 2026-04-01\nupdated: 2026-04-01\nsources: []\ncited_by: []\n---\n\n# Quoted\n\n## Findings\n`;
    fs.writeFileSync(absolutePath, before);
    assert.throws(
      () =>
        writeKnowledgeArtifact(pmDir, {
          artifactPath,
          topic: "Quoted",
          summary: "New claim",
          findings: ["Uncited new finding."],
        }),
      /missing an evidence citation/
    );
    assert.equal(fs.readFileSync(absolutePath, "utf8"), before);
    assert.equal(fs.existsSync(path.join(pmDir, "evidence/research/index.md")), false);
    assert.equal(fs.existsSync(path.join(pmDir, "evidence/research/log.md")), false);
  }
});

test("qualified findings retain complete selection, replay, and supersession identity", (t) => {
  const { pmDir, cleanup } = createPmDir();
  t.after(cleanup);
  const {
    extractFindings,
    loadSourceDocument,
    validateSelections,
  } = require("../scripts/insight-rewrite.js");
  const artifactPath = "evidence/research/approval-conditions.md";
  const claim =
    "[internal] Managers approve leave only after:\n  - checking team coverage\n    against the same team context\n  - confirming the request is pending\n\n  Only assigned approvers may complete this action.";
  const unrelated = "[internal] Administrators can inspect completed requests.";
  const base = {
    artifactPath,
    topic: "Leave approval",
    summary: "Conditions constrain approval",
    findings: [claim],
  };
  writeKnowledgeArtifact(pmDir, base);
  writeKnowledgeArtifact(pmDir, { ...base, findings: [unrelated] });
  writeKnowledgeArtifact(pmDir, base);
  const absolutePath = path.join(pmDir, artifactPath);
  const complete = claim.replace(/\s+/g, " ").trim();
  assert.deepEqual(extractFindings(fs.readFileSync(absolutePath, "utf8")), [complete, unrelated]);
  assert.deepEqual(validateSelections(loadSourceDocument(pmDir, artifactPath), [claim]), [
    complete,
  ]);
  assert.throws(
    () => validateSelections(loadSourceDocument(pmDir, artifactPath), ["checking team coverage"]),
    /no longer exists/
  );
  const replacement =
    "[internal] Delegates may approve only when the same coverage conditions hold.";
  writeKnowledgeArtifact(pmDir, {
    ...base,
    findings: [replacement],
    supersedes: [{ finding: claim, replacement, reason: "Verified delegated approval policy." }],
  });
  const content = fs.readFileSync(absolutePath, "utf8");
  assert.deepEqual(extractFindings(content), [unrelated, replacement]);
  assert.match(content, /Superseded: \[internal\] Managers approve leave only after:/);
  assert.match(content, /Only assigned approvers may complete this action/);
});

test("supersession resumes index or log failures once and rejects conflicting replay", async (t) => {
  for (const target of ["index.md", "log.md"]) {
    await t.test(target, (t) => {
      const { pmDir, cleanup } = createPmDir();
      t.after(cleanup);
      const artifactPath = "evidence/research/import-recovery.md";
      const original = "[internal] CSV import is the only supported format.";
      const replacement = "[internal] CSV and JSON import are supported.";
      const base = {
        artifactPath,
        topic: "Import",
        summary: "Supported formats",
        findings: [original],
      };
      writeKnowledgeArtifact(pmDir, base);
      const failedPath = path.join(pmDir, "evidence/research", target);
      fs.unlinkSync(failedPath);
      fs.mkdirSync(failedPath);
      const correction = {
        finding: original,
        replacement,
        reason: "Verified supported runtime.\n\nAlso inspected the public schema.",
      };
      const update = { ...base, findings: [replacement], supersedes: [correction] };
      assert.throws(() => writeKnowledgeArtifact(pmDir, update), /EISDIR/);
      const absolutePath = path.join(pmDir, artifactPath);
      assert.match(fs.readFileSync(absolutePath, "utf8"), /## Superseded Findings/);
      fs.rmdirSync(failedPath);
      assert.doesNotThrow(() => writeKnowledgeArtifact(pmDir, update));
      const content = fs.readFileSync(absolutePath, "utf8");
      assert.equal((content.match(/Superseded:/g) || []).length, 1);
      assert.equal((content.match(/^1\. \[internal\] CSV and JSON import/gm) || []).length, 1);
      assert.match(
        fs.readFileSync(path.join(pmDir, "evidence/research/index.md"), "utf8"),
        /import-recovery.md/
      );
      const log = fs.readFileSync(path.join(pmDir, "evidence/research/log.md"), "utf8");
      assert.match(log, /update evidence\/research\/import-recovery.md/);
      writeKnowledgeArtifact(pmDir, update);
      assert.equal(fs.readFileSync(path.join(pmDir, "evidence/research/log.md"), "utf8"), log);
      for (const supersedes of [
        [{ ...correction, reason: "A different rationale" }],
        [{ ...correction, replacement: "[internal] XML is supported." }],
      ]) {
        assert.throws(
          () => writeKnowledgeArtifact(pmDir, { ...update, supersedes }),
          /exact completed correction/
        );
        assert.equal(fs.readFileSync(absolutePath, "utf8"), content);
      }
      assert.throws(
        () => writeKnowledgeArtifact(pmDir, { ...update, sourceOrigin: "external" }),
        /another origin|exact completed correction/
      );
      assert.equal(fs.readFileSync(absolutePath, "utf8"), content);
      const missingReplacement = content.replace(
        /^1\. \[internal\] CSV and JSON import are supported\.$/m,
        "1. [internal] Current replacement was removed."
      );
      fs.writeFileSync(absolutePath, missingReplacement);
      assert.throws(() => writeKnowledgeArtifact(pmDir, update), /exact completed correction/);
      assert.equal(fs.readFileSync(absolutePath, "utf8"), missingReplacement);
      assert.equal(fs.readFileSync(path.join(pmDir, "evidence/research/log.md"), "utf8"), log);
    });
  }
});
