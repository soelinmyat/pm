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
    assert.match(content, /created: "2026-04-01"/);
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
