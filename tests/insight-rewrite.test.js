"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { rewriteInsights } = require("../scripts/insight-rewrite.js");

function createPmDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "insight-rewrite-"));
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

function makeEvidence(topic, summary, finding) {
  return `---
type: "evidence"
evidence_type: "research"
topic: "${topic}"
source_origin: "internal"
created: "2026-04-10"
updated: "2026-04-10"
sources: []
cited_by: []
---

# ${topic}

## Summary

${summary}

## Findings

1. ${finding}
`;
}

test("rewriteInsights compiles a linked draft insight into canonical synthesis", () => {
  const { pmDir, cleanup } = createPmDir();
  try {
    writeFile(
      pmDir,
      "evidence/research/one.md",
      makeEvidence(
        "Telemetry Coverage",
        "Telemetry coverage currently stops at coarse skill invocation events.",
        "The existing logs do not capture per-step spans or retries."
      )
    );
    writeFile(
      pmDir,
      "evidence/research/two.md",
      makeEvidence(
        "Health Signals",
        "Health signals need to distinguish freshness from synthesis coverage.",
        "A fresh KB can still have uncited evidence and hungry insights."
      )
    );
    writeFile(
      pmDir,
      "insights/product/loop.md",
      `---
type: "insight"
domain: "product"
topic: "Knowledge Loop"
last_updated: "2026-04-10"
last_updated: "2026-04-11"
status: "draft"
confidence: "low"
sources:
  - "evidence/research/one.md"
  - "evidence/research/two.md"
---

# Knowledge Loop

Seeded from strategy.md. No evidence routed yet.
`
    );

    const result = rewriteInsights(
      pmDir,
      { insights: ["insights/product/loop.md"] },
      { now: "2026-04-13" }
    );

    assert.equal(result.insights[0].action, "rewritten");
    assert.equal(result.insights[0].status, "active");
    assert.equal(result.insights[0].confidence, "medium");

    const content = fs.readFileSync(path.join(pmDir, "insights/product/loop.md"), "utf8");
    assert.equal((content.match(/last_updated:/g) || []).length, 1);
    assert.match(content, /status: "active"/);
    assert.match(content, /confidence: "medium"/);
    assert.match(content, /## Synthesis/);
    assert.match(
      content,
      /Telemetry Coverage says Telemetry coverage currently stops at coarse skill invocation events\./
    );
    assert.match(content, /## Key Findings/);
    assert.match(content, /1\. The existing logs do not capture per-step spans or retries\./);
    assert.match(content, /2\. A fresh KB can still have uncited evidence and hungry insights\./);
    assert.match(content, /## Confidence Rationale/);
    assert.doesNotMatch(content, /No evidence routed yet/);
  } finally {
    cleanup();
  }
});

test("rewriteInsights omits confidence rationale for low-confidence single-source insights", () => {
  const { pmDir, cleanup } = createPmDir();
  try {
    writeFile(
      pmDir,
      "evidence/research/one.md",
      makeEvidence(
        "Single Source",
        "A single source can still compile into a usable insight body.",
        "Low-confidence insights should omit the rationale section."
      )
    );
    writeFile(
      pmDir,
      "insights/product/single.md",
      `---
type: "insight"
domain: "product"
topic: "Single Source Insight"
last_updated: "2026-04-10"
status: "draft"
confidence: "low"
sources:
  - "evidence/research/one.md"
---

# Single Source Insight

Seeded from routed evidence. Synthesis refresh pending.
`
    );

    const result = rewriteInsights(
      pmDir,
      { insights: ["insights/product/single.md"] },
      { now: "2026-04-13" }
    );
    assert.equal(result.insights[0].confidence, "low");

    const content = fs.readFileSync(path.join(pmDir, "insights/product/single.md"), "utf8");
    assert.doesNotMatch(content, /## Confidence Rationale/);
    assert.match(content, /status: "active"/);
  } finally {
    cleanup();
  }
});
