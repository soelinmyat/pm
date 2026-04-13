"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync, spawnSync } = require("child_process");

const HOT_INDEX_SCRIPT = path.join(__dirname, "..", "scripts", "hot-index.js");
const VALIDATE_SCRIPT = path.join(__dirname, "..", "scripts", "validate.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withPmDir(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hot-index-test-"));
  const pmDir = path.join(root, "pm");
  fs.mkdirSync(path.join(pmDir, "insights"), { recursive: true });

  if (files) {
    for (const [relPath, content] of Object.entries(files)) {
      const full = path.join(root, relPath);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }
  }

  return {
    root,
    pmDir,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function makeInsight(overrides = {}) {
  const defaults = {
    type: "insight",
    domain: "product",
    topic: "Test Topic",
    last_updated: "2026-04-10",
    status: "active",
    confidence: "medium",
    sources: ["evidence/research/test.md"],
  };
  const d = { ...defaults, ...overrides };
  let fm = "---\n";
  for (const [key, value] of Object.entries(d)) {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        fm += `${key}: []\n`;
      } else {
        fm += `${key}:\n`;
        for (const item of value) {
          fm += `  - ${item}\n`;
        }
      }
    } else {
      fm += `${key}: ${value}\n`;
    }
  }
  fm += "---\n\n# " + d.topic + "\n\nTest content.\n";
  return fm;
}

function runHotIndex(pmDir, extraArgs = []) {
  const args = [HOT_INDEX_SCRIPT, "--dir", pmDir, ...extraArgs];
  const result = spawnSync("node", args, { encoding: "utf8", timeout: 10000 });
  return {
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    exitCode: result.status,
  };
}

function runValidate(pmDir) {
  try {
    const stdout = execFileSync("node", [VALIDATE_SCRIPT, "--dir", pmDir], { encoding: "utf8" });
    return JSON.parse(stdout);
  } catch (err) {
    return JSON.parse(err.stdout);
  }
}

function makeBacklogItem(overrides = {}) {
  const defaults = {
    id: "PM-001",
    title: "Test item",
    outcome: "Something happens",
    status: "idea",
    priority: "medium",
    parent: "null",
    created: "2026-03-14",
    updated: "2026-03-14",
  };
  const d = { ...defaults, ...overrides };
  let fm = "---\n";
  for (const [k, v] of Object.entries(d)) {
    if (Array.isArray(v)) {
      if (v.length === 0) {
        fm += `${k}: []\n`;
      } else {
        fm += `${k}:\n`;
        for (const item of v) fm += `  - "${item}"\n`;
      }
    } else {
      fm += `${k}: ${v}\n`;
    }
  }
  fm += "---\n\n## Outcome\n\nTest outcome.\n";
  return fm;
}

function makeEvidence(overrides = {}) {
  const defaults = {
    type: "evidence",
    evidence_type: "research",
    source_origin: "external",
    created: "2026-04-06",
    sources: ["https://example.com"],
    cited_by: ["insights/product/test-topic.md"],
  };
  const d = { ...defaults, ...overrides };
  let fm = "---\n";
  for (const [key, value] of Object.entries(d)) {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        fm += `${key}: []\n`;
      } else {
        fm += `${key}:\n`;
        for (const item of value) {
          fm += `  - ${item}\n`;
        }
      }
    } else {
      fm += `${key}: ${value}\n`;
    }
  }
  fm += "---\n\n# Evidence\n\nTest evidence.\n";
  return fm;
}

function makeIndexMd(files) {
  let content = "| Topic/Source | Description | Updated | Status |\n";
  content += "|---|---|---|---|\n";
  for (const file of files) {
    content += `| [${file}](${file}) | Description | 2026-04-10 | active |\n`;
  }
  return content;
}

function makeLogMd(entries = []) {
  return entries.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Tests: Generate mode
// ---------------------------------------------------------------------------

test("generate mode: creates .hot.md with 5 insights across 2 domains", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/insights/product/index.md": makeIndexMd(["topic-a.md", "topic-b.md", "topic-c.md"]),
    "pm/insights/product/log.md": makeLogMd([]),
    "pm/insights/product/topic-a.md": makeInsight({
      topic: "Topic A",
      domain: "product",
      confidence: "high",
      sources: ["evidence/research/a.md", "evidence/research/b.md"],
    }),
    "pm/insights/product/topic-b.md": makeInsight({
      topic: "Topic B",
      domain: "product",
      confidence: "medium",
      sources: ["evidence/research/c.md"],
    }),
    "pm/insights/product/topic-c.md": makeInsight({
      topic: "Topic C",
      domain: "product",
      confidence: "low",
      sources: [],
    }),
    "pm/insights/business/index.md": makeIndexMd(["biz-topic-a.md", "biz-topic-b.md"]),
    "pm/insights/business/log.md": makeLogMd([]),
    "pm/insights/business/biz-topic-a.md": makeInsight({
      topic: "Biz Topic A",
      domain: "business",
      confidence: "high",
      sources: ["evidence/research/d.md", "evidence/research/e.md", "evidence/research/f.md"],
    }),
    "pm/insights/business/biz-topic-b.md": makeInsight({
      topic: "Biz Topic B",
      domain: "business",
      confidence: "low",
      sources: [],
    }),
    "pm/backlog/test.md": makeBacklogItem(),
  });

  t.after(cleanup);

  const result = runHotIndex(pmDir, ["--generate"]);
  assert.equal(result.exitCode, 0);

  const hotPath = path.join(pmDir, "insights", ".hot.md");
  assert.ok(fs.existsSync(hotPath), ".hot.md should exist");

  const content = fs.readFileSync(hotPath, "utf8");

  // Check frontmatter
  assert.ok(content.includes("generated:"), "should have generated date");
  assert.ok(content.includes("count: 5"), "should have count 5");

  // Check table structure
  assert.ok(
    content.includes("| Domain | Topic | Status | Confidence | Sources | Updated |"),
    "should have header"
  );

  // Count data rows
  const dataRows = content
    .split("\n")
    .filter((l) => l.startsWith("|") && !l.includes("---") && !l.includes("Domain"));
  assert.equal(dataRows.length, 5, "should have 5 data rows");

  // Verify sort order: business before product (alpha), within domain by source count desc
  const domains = dataRows.map((r) => r.split("|")[1].trim());
  assert.equal(domains[0], "business");
  assert.equal(domains[1], "business");
  assert.equal(domains[2], "product");

  // business domain: Biz Topic A (3 sources) before Biz Topic B (0 sources)
  assert.ok(dataRows[0].includes("Biz Topic A"));
  assert.ok(dataRows[1].includes("Biz Topic B"));

  // product domain: Topic A (2 sources) before Topic B (1 source) before Topic C (0 sources)
  assert.ok(dataRows[2].includes("Topic A"));
  assert.ok(dataRows[3].includes("Topic B"));
  assert.ok(dataRows[4].includes("Topic C"));
});

// ---------------------------------------------------------------------------
// Tests: Filter mode
// ---------------------------------------------------------------------------

test("filter by domain: returns only matching domain", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/insights/product/topic-a.md": makeInsight({ topic: "Topic A", domain: "product" }),
    "pm/insights/business/topic-b.md": makeInsight({ topic: "Topic B", domain: "business" }),
  });
  t.after(cleanup);

  runHotIndex(pmDir, ["--generate"]);
  const result = runHotIndex(pmDir, ["--domain", "product"]);
  assert.equal(result.exitCode, 0);
  assert.ok(result.stdout.includes("Topic A"));
  assert.ok(!result.stdout.includes("Topic B"));
});

test("filter by confidence: returns only matching confidence", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/insights/product/high.md": makeInsight({ topic: "High Conf", confidence: "high" }),
    "pm/insights/product/low.md": makeInsight({ topic: "Low Conf", confidence: "low" }),
  });
  t.after(cleanup);

  runHotIndex(pmDir, ["--generate"]);
  const result = runHotIndex(pmDir, ["--confidence", "high"]);
  assert.equal(result.exitCode, 0);
  assert.ok(result.stdout.includes("High Conf"));
  assert.ok(!result.stdout.includes("Low Conf"));
});

test("filter by min-sources: returns only insights with enough sources", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/insights/product/zero.md": makeInsight({ topic: "Zero Sources", sources: [] }),
    "pm/insights/product/one.md": makeInsight({
      topic: "One Source",
      sources: ["evidence/research/a.md"],
    }),
    "pm/insights/product/three.md": makeInsight({
      topic: "Three Sources",
      sources: ["evidence/research/a.md", "evidence/research/b.md", "evidence/research/c.md"],
    }),
  });
  t.after(cleanup);

  runHotIndex(pmDir, ["--generate"]);
  const result = runHotIndex(pmDir, ["--min-sources", "2"]);
  assert.equal(result.exitCode, 0);
  assert.ok(result.stdout.includes("Three Sources"));
  assert.ok(!result.stdout.includes("Zero Sources"));
  assert.ok(!result.stdout.includes("One Source"));
});

test("filter by since: returns only recently updated insights", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/insights/product/old.md": makeInsight({ topic: "Old Topic", last_updated: "2026-03-01" }),
    "pm/insights/product/new.md": makeInsight({ topic: "New Topic", last_updated: "2026-04-10" }),
  });
  t.after(cleanup);

  runHotIndex(pmDir, ["--generate"]);
  const result = runHotIndex(pmDir, ["--since", "2026-04-01"]);
  assert.equal(result.exitCode, 0);
  assert.ok(result.stdout.includes("New Topic"));
  assert.ok(!result.stdout.includes("Old Topic"));
});

test("filter by hungry: returns draft, low-confidence, or under-sourced insights", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/insights/product/draft.md": makeInsight({
      topic: "Draft Topic",
      status: "draft",
      confidence: "medium",
      sources: ["evidence/research/a.md", "evidence/research/b.md"],
    }),
    "pm/insights/product/low-confidence.md": makeInsight({
      topic: "Low Confidence",
      status: "active",
      confidence: "low",
      sources: ["evidence/research/a.md", "evidence/research/b.md"],
    }),
    "pm/insights/product/under-sourced.md": makeInsight({
      topic: "Under Sourced",
      status: "active",
      confidence: "high",
      sources: ["evidence/research/a.md"],
    }),
    "pm/insights/product/healthy.md": makeInsight({
      topic: "Healthy Topic",
      status: "active",
      confidence: "high",
      sources: ["evidence/research/a.md", "evidence/research/b.md", "evidence/research/c.md"],
    }),
  });
  t.after(cleanup);

  runHotIndex(pmDir, ["--generate"]);
  const result = runHotIndex(pmDir, ["--hungry"]);
  assert.equal(result.exitCode, 0);
  assert.ok(result.stdout.includes("Draft Topic"));
  assert.ok(result.stdout.includes("Low Confidence"));
  assert.ok(result.stdout.includes("Under Sourced"));
  assert.ok(!result.stdout.includes("Healthy Topic"));
});

test("composable filters: domain + confidence returns intersection", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/insights/product/high-prod.md": makeInsight({
      topic: "High Product",
      domain: "product",
      confidence: "high",
    }),
    "pm/insights/product/low-prod.md": makeInsight({
      topic: "Low Product",
      domain: "product",
      confidence: "low",
    }),
    "pm/insights/business/high-biz.md": makeInsight({
      topic: "High Biz",
      domain: "business",
      confidence: "high",
    }),
  });
  t.after(cleanup);

  runHotIndex(pmDir, ["--generate"]);
  const result = runHotIndex(pmDir, ["--domain", "product", "--confidence", "high"]);
  assert.equal(result.exitCode, 0);
  assert.ok(result.stdout.includes("High Product"));
  assert.ok(!result.stdout.includes("Low Product"));
  assert.ok(!result.stdout.includes("High Biz"));
});

// ---------------------------------------------------------------------------
// Tests: Dot-file exclusion
// ---------------------------------------------------------------------------

test("dot-file exclusion: .hot.md is not scanned as an insight file", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/insights/product/real-topic.md": makeInsight({ topic: "Real Topic" }),
  });
  t.after(cleanup);

  // Generate first to create .hot.md
  runHotIndex(pmDir, ["--generate"]);
  assert.ok(fs.existsSync(path.join(pmDir, "insights", ".hot.md")));

  // Re-generate — .hot.md should not appear as a row in the output
  const result = runHotIndex(pmDir, ["--generate"]);
  assert.equal(result.exitCode, 0);

  const content = fs.readFileSync(path.join(pmDir, "insights", ".hot.md"), "utf8");
  assert.ok(content.includes("count: 1"), "should still be count 1, not 2");
  assert.ok(!content.includes(".hot"), ".hot.md should not appear in the table");
});

// ---------------------------------------------------------------------------
// Tests: Validator exclusion
// ---------------------------------------------------------------------------

test("validator walker excludes dot-prefixed files", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/insights/product/index.md": makeIndexMd(["real-insight.md"]),
    "pm/insights/product/log.md": makeLogMd([]),
    "pm/insights/product/real-insight.md": makeInsight({
      topic: "Real Insight",
      domain: "product",
      sources: ["evidence/research/test.md"],
    }),
    "pm/insights/product/.hot.md": "---\ngenerated: 2026-04-11\ncount: 1\n---\n\n# Hot Index\n",
    "pm/evidence/research/index.md": makeIndexMd(["test.md"]),
    "pm/evidence/research/log.md": makeLogMd([]),
    "pm/evidence/research/test.md": makeEvidence({
      cited_by: ["insights/product/real-insight.md"],
    }),
    "pm/backlog/test.md": makeBacklogItem(),
  });
  t.after(cleanup);

  const result = runValidate(pmDir);
  // .hot.md should not cause a "no YAML frontmatter found" or "missing required field" error
  const hotMdErrors = result.details.filter((d) => d.file && d.file.includes(".hot"));
  assert.equal(hotMdErrors.length, 0, ".hot.md should not generate any validation errors");
});

test("validateIndexFile excludes dot-prefixed files from expectedFiles", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/insights/product/index.md": makeIndexMd(["real-insight.md"]),
    "pm/insights/product/log.md": makeLogMd([]),
    "pm/insights/product/real-insight.md": makeInsight({
      topic: "Real Insight",
      domain: "product",
      sources: ["evidence/research/test.md"],
    }),
    "pm/insights/product/.hot.md": "---\ngenerated: 2026-04-11\ncount: 1\n---\n\n# Hot Index\n",
    "pm/evidence/research/index.md": makeIndexMd(["test.md"]),
    "pm/evidence/research/log.md": makeLogMd([]),
    "pm/evidence/research/test.md": makeEvidence({
      cited_by: ["insights/product/real-insight.md"],
    }),
    "pm/backlog/test.md": makeBacklogItem(),
  });
  t.after(cleanup);

  const result = runValidate(pmDir);
  // .hot.md should not be flagged as "missing index row"
  const missingRowErrors = result.details.filter((d) => d.message && d.message.includes(".hot.md"));
  assert.equal(
    missingRowErrors.length,
    0,
    ".hot.md should not be flagged as missing from index.md"
  );
});

// ---------------------------------------------------------------------------
// Tests: Malformed frontmatter
// ---------------------------------------------------------------------------

test("malformed: file with no frontmatter is skipped with warning", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/insights/product/good.md": makeInsight({ topic: "Good Topic" }),
    "pm/insights/product/bad.md": "# No frontmatter here\n\nJust content.\n",
  });
  t.after(cleanup);

  const result = runHotIndex(pmDir, ["--generate"]);
  assert.equal(result.exitCode, 0);
  assert.ok(result.stderr.includes("warning"), "should warn about missing frontmatter");

  const content = fs.readFileSync(path.join(pmDir, "insights", ".hot.md"), "utf8");
  assert.ok(content.includes("count: 1"), "should only index the good file");
});

test("malformed: partial YAML (missing closing ---) is skipped gracefully", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/insights/product/good.md": makeInsight({ topic: "Good Topic" }),
    "pm/insights/product/partial.md": "---\ntype: insight\ndomain: product\n\n# Incomplete\n",
  });
  t.after(cleanup);

  const result = runHotIndex(pmDir, ["--generate"]);
  assert.equal(result.exitCode, 0);

  const content = fs.readFileSync(path.join(pmDir, "insights", ".hot.md"), "utf8");
  assert.ok(content.includes("count: 1"), "should only index the good file");
});

test("malformed: missing optional fields handled without crash", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/insights/product/minimal.md":
      "---\ntype: insight\ndomain: product\ntopic: Minimal\nlast_updated: 2026-04-10\nstatus: active\nsources: []\n---\n\n# Minimal\n",
  });
  t.after(cleanup);

  // No confidence field — should default gracefully
  const result = runHotIndex(pmDir, ["--generate"]);
  assert.equal(result.exitCode, 0);

  const content = fs.readFileSync(path.join(pmDir, "insights", ".hot.md"), "utf8");
  assert.ok(content.includes("count: 1"));
  assert.ok(content.includes("Minimal"));
  assert.ok(content.includes("low"), "missing confidence should default to low");
});

// ---------------------------------------------------------------------------
// Tests: Non-insight type exclusion
// ---------------------------------------------------------------------------

test("non-insight type files are excluded from the index", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/insights/product/real.md": makeInsight({ topic: "Real Insight" }),
    "pm/insights/product/landscape.md":
      "---\ntype: landscape\ndomain: product\n---\n\n# Landscape\n",
  });
  t.after(cleanup);

  const result = runHotIndex(pmDir, ["--generate"]);
  assert.equal(result.exitCode, 0);

  const content = fs.readFileSync(path.join(pmDir, "insights", ".hot.md"), "utf8");
  assert.ok(content.includes("count: 1"), "should only index type: insight files");
  assert.ok(!content.includes("Landscape"));
});

// ---------------------------------------------------------------------------
// Tests: Empty KB
// ---------------------------------------------------------------------------

test("empty KB: generates .hot.md with count 0", (t) => {
  const { pmDir, cleanup } = withPmDir({});
  t.after(cleanup);

  const result = runHotIndex(pmDir, ["--generate"]);
  assert.equal(result.exitCode, 0);

  const hotPath = path.join(pmDir, "insights", ".hot.md");
  assert.ok(fs.existsSync(hotPath));

  const content = fs.readFileSync(hotPath, "utf8");
  assert.ok(content.includes("count: 0"));

  // Should have header but no data rows
  const dataRows = content
    .split("\n")
    .filter((l) => l.startsWith("|") && !l.includes("---") && !l.includes("Domain"));
  assert.equal(dataRows.length, 0);
});

// ---------------------------------------------------------------------------
// Tests: Performance
// ---------------------------------------------------------------------------

test("performance: 200 insight files in under 1s", (t) => {
  const files = {};
  for (let i = 0; i < 200; i++) {
    const domain =
      i % 4 === 0 ? "product" : i % 4 === 1 ? "business" : i % 4 === 2 ? "trends" : "technical";
    const slug = `topic-${String(i).padStart(3, "0")}.md`;
    const sources = [];
    for (let s = 0; s < i % 5; s++) {
      sources.push(`evidence/research/src-${i}-${s}.md`);
    }
    files[`pm/insights/${domain}/${slug}`] = makeInsight({
      topic: `Topic ${i}`,
      domain,
      confidence: i % 3 === 0 ? "high" : i % 3 === 1 ? "medium" : "low",
      sources,
      last_updated: `2026-04-${String((i % 28) + 1).padStart(2, "0")}`,
    });
  }

  const { pmDir, cleanup } = withPmDir(files);
  t.after(cleanup);

  const start = performance.now();
  const result = runHotIndex(pmDir, ["--generate"]);
  const elapsed = performance.now() - start;

  assert.equal(result.exitCode, 0);
  assert.ok(elapsed < 1000, `should complete in under 1s, took ${elapsed.toFixed(0)}ms`);

  const content = fs.readFileSync(path.join(pmDir, "insights", ".hot.md"), "utf8");
  assert.ok(content.includes("count: 200"));
});

// ---------------------------------------------------------------------------
// Tests: Atomic write
// ---------------------------------------------------------------------------

test("atomic write: no .hot.md.tmp left after successful generation", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/insights/product/topic.md": makeInsight({ topic: "Topic" }),
  });
  t.after(cleanup);

  runHotIndex(pmDir, ["--generate"]);

  const tmpPath = path.join(pmDir, "insights", ".hot.md.tmp");
  assert.ok(!fs.existsSync(tmpPath), ".hot.md.tmp should not exist after success");
  assert.ok(fs.existsSync(path.join(pmDir, "insights", ".hot.md")), ".hot.md should exist");
});

// ---------------------------------------------------------------------------
// Tests: Error handling
// ---------------------------------------------------------------------------

test("missing --dir exits with error", (_t) => {
  const result = runHotIndex("/nonexistent", []);
  assert.notEqual(result.exitCode, 0);
});

test("filter mode with missing .hot.md exits with error", (t) => {
  const { pmDir, cleanup } = withPmDir({});
  t.after(cleanup);

  const result = runHotIndex(pmDir, ["--domain", "product"]);
  assert.notEqual(result.exitCode, 0);
  assert.ok(result.stderr.includes("not found"));
});
