"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const { generateRouteSuggestions } = require("../scripts/insight-route-suggestions.js");

const SUGGESTIONS_SCRIPT = path.join(__dirname, "..", "scripts", "insight-route-suggestions.js");

function createPmDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "route-suggestions-"));
  const pmDir = path.join(root, "pm");
  fs.mkdirSync(pmDir, { recursive: true });
  return {
    pmDir,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function writeFile(root, relativePath, content) {
  const absolutePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content);
}

function makeInsight({ domain, topic, body, sources = [] }) {
  return [
    "---",
    'type: "insight"',
    `domain: "${domain}"`,
    `topic: "${topic}"`,
    'last_updated: "2026-04-10"',
    'status: "active"',
    'confidence: "medium"',
    sources.length > 0 ? "sources:" : "sources: []",
    ...sources.map((item) => `  - "${item}"`),
    "---",
    "",
    `# ${topic}`,
    "",
    body,
    "",
  ].join("\n");
}

function makeEvidence({ topic, summary, findings, citedBy = [] }) {
  return [
    "---",
    'type: "evidence"',
    'evidence_type: "research"',
    `topic: "${topic}"`,
    'source_origin: "internal"',
    'created: "2026-04-10"',
    'updated: "2026-04-10"',
    "sources: []",
    citedBy.length > 0 ? "cited_by:" : "cited_by: []",
    ...citedBy.map((item) => `  - "${item}"`),
    "---",
    "",
    `# ${topic}`,
    "",
    "## Summary",
    "",
    summary,
    "",
    "## Findings",
    "",
    ...findings.map((item, index) => `${index + 1}. ${item}`),
    "",
  ].join("\n");
}

test("generateRouteSuggestions ranks matching existing insights first", () => {
  const { pmDir, cleanup } = createPmDir();
  try {
    writeFile(
      pmDir,
      "insights/product/checkout-reliability.md",
      makeInsight({
        domain: "product",
        topic: "Checkout Reliability",
        body: "## Synthesis\n\nCheckout retry states and reliability rules shape the purchase flow.",
      })
    );
    writeFile(
      pmDir,
      "insights/business/pricing.md",
      makeInsight({
        domain: "business",
        topic: "Pricing Expansion",
        body: "## Synthesis\n\nPricing and packaging research feeds business expansion topics.",
      })
    );
    writeFile(
      pmDir,
      "evidence/research/checkout-implementation-learnings.md",
      makeEvidence({
        topic: "Checkout — Implementation Learnings",
        summary: "Implementation exposed a missing retry rule in the checkout flow.",
        findings: [
          "Checkout retry states were missing from the acceptance criteria.",
          "Reliability gaps cause duplicate user actions during purchase.",
        ],
      })
    );

    const result = generateRouteSuggestions(pmDir, {
      evidencePath: "evidence/research/checkout-implementation-learnings.md",
      artifactMode: "implementation-learnings",
    });

    assert.equal(
      result.items[0].suggestions[0].insightPath,
      "insights/product/checkout-reliability.md"
    );
    assert.match(result.items[0].suggestions[0].reason, /Matched terms:/);
    assert.equal(result.items[0].suggestedNewRoute, null);
  } finally {
    cleanup();
  }
});

test("generateRouteSuggestions skips already-linked insights and falls back to a seeded new route", () => {
  const { pmDir, cleanup } = createPmDir();
  try {
    writeFile(
      pmDir,
      "insights/product/existing.md",
      makeInsight({
        domain: "product",
        topic: "Existing Loop",
        body: "## Synthesis\n\nLoop coverage already includes this evidence.",
        sources: ["evidence/research/loop-decisions.md"],
      })
    );
    writeFile(
      pmDir,
      "evidence/research/loop-decisions.md",
      makeEvidence({
        topic: "Knowledge Loop — Groom Decisions",
        summary: "The groom cycle clarified how the knowledge loop should behave.",
        findings: ["The loop should surface durable targets earlier."],
      })
    );

    const result = generateRouteSuggestions(pmDir, {
      evidencePath: "evidence/research/loop-decisions.md",
      artifactMode: "decision-record",
    });

    assert.equal(result.items[0].suggestions.length, 0);
    assert.equal(result.items[0].suggestedNewRoute.mode, "new");
    assert.equal(result.items[0].suggestedNewRoute.domain, "product");
    assert.equal(
      result.items[0].suggestedNewRoute.insightPath,
      "insights/product/knowledge-loop.md"
    );
  } finally {
    cleanup();
  }
});

test("generateRouteSuggestions avoids colliding with an existing insight path for seeded routes", () => {
  const { pmDir, cleanup } = createPmDir();
  try {
    writeFile(
      pmDir,
      "insights/product/knowledge-loop.md",
      makeInsight({
        domain: "product",
        topic: "Retention Model",
        body: "## Synthesis\n\nThis topic is unrelated to retention experiments.",
      })
    );
    writeFile(
      pmDir,
      "evidence/research/loop-decisions.md",
      makeEvidence({
        topic: "Knowledge Loop — Groom Decisions",
        summary: "The groom cycle clarified how the knowledge loop should behave.",
        findings: ["The loop should surface durable targets earlier."],
      })
    );

    const result = generateRouteSuggestions(pmDir, {
      evidencePath: "evidence/research/loop-decisions.md",
      artifactMode: "decision-record",
    });

    assert.equal(result.items[0].suggestions.length, 0);
    assert.equal(result.items[0].suggestedNewRoute.mode, "new");
    assert.equal(
      result.items[0].suggestedNewRoute.insightPath,
      "insights/product/knowledge-loop-2.md"
    );
  } finally {
    cleanup();
  }
});

test("insight-route-suggestions CLI returns deterministic JSON", () => {
  const { pmDir, cleanup } = createPmDir();
  try {
    writeFile(
      pmDir,
      "insights/product/shared-dashboard-alignment.md",
      makeInsight({
        domain: "product",
        topic: "Shared Dashboard Alignment",
        body: "## Synthesis\n\nShared dashboard alignment depends on fresh signals and KB health.",
      })
    );
    writeFile(
      pmDir,
      "evidence/research/dashboard-decisions.md",
      makeEvidence({
        topic: "Shared Dashboard — Groom Decisions",
        summary: "The dashboard should expose compounding signals.",
        findings: ["Shared dashboard work needs KB health and compounding signal alignment."],
      })
    );

    const stdout = execFileSync("node", [SUGGESTIONS_SCRIPT, "--pm-dir", pmDir], {
      input: JSON.stringify({
        evidencePath: "evidence/research/dashboard-decisions.md",
        artifactMode: "decision-record",
      }),
      encoding: "utf8",
    });

    const result = JSON.parse(stdout);
    assert.equal(
      result.items[0].suggestions[0].insightPath,
      "insights/product/shared-dashboard-alignment.md"
    );
  } finally {
    cleanup();
  }
});
