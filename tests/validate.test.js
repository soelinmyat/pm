"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

const VALIDATE_SCRIPT = path.join(__dirname, "..", "scripts", "validate.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withPmDir(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "validate-test-"));
  const pmDir = path.join(root, "pm");
  fs.mkdirSync(path.join(pmDir, "backlog"), { recursive: true });

  if (files) {
    for (const [relPath, content] of Object.entries(files)) {
      const full = path.join(root, relPath);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }
  }

  return {
    pmDir,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
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
    type: "backlog-issue",
    id: "PM-001",
    title: "Test item",
    outcome: "Something happens",
    status: "idea",
    priority: "medium",
    parent: "null",
    children: [],
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

function makeFrontmatterDocument(data, heading = "Document") {
  let fm = "---\n";
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        fm += `${key}: []\n`;
      } else {
        fm += `${key}:\n`;
        for (const item of value) {
          fm += `  - "${item}"\n`;
        }
      }
    } else {
      fm += `${key}: ${value}\n`;
    }
  }
  fm += `---\n\n# ${heading}\n`;
  return fm;
}

function makeInsight(overrides = {}) {
  return makeFrontmatterDocument(
    {
      type: "insight",
      domain: "business",
      topic: "Reporting gaps",
      last_updated: "2026-04-06",
      status: "active",
      confidence: "medium",
      sources: ["evidence/research/reporting-gaps.md"],
      ...overrides,
    },
    "Reporting gaps"
  );
}

function makeEvidence(overrides = {}) {
  return makeFrontmatterDocument(
    {
      type: "evidence",
      evidence_type: "research",
      source_origin: "external",
      created: "2026-04-06",
      sources: ["https://example.com/report.pdf"],
      cited_by: ["insights/business/reporting-gaps.md"],
      ...overrides,
    },
    "Reporting gaps source"
  );
}

function makeIndex(rows) {
  return [
    "# Index",
    "",
    "| Topic/Source | Description | Updated | Status |",
    "|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}

function makeLog(lines) {
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("valid backlog item passes validation", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/test-item.md": makeBacklogItem(),
  });
  t.after(cleanup);

  const result = runValidate(pmDir);
  assert.equal(result.ok, true);
  assert.equal(result.backlog_items, 1);
  assert.equal(result.errors, 0);
});

test("missing required field reports error", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/bad.md": makeBacklogItem({ status: undefined }),
  });
  // Remove the status line manually since makeBacklogItem writes "status: undefined"
  const filePath = path.join(pmDir, "backlog", "bad.md");
  const content = fs.readFileSync(filePath, "utf8").replace(/^status:.*\n/m, "");
  fs.writeFileSync(filePath, content);
  t.after(cleanup);

  const result = runValidate(pmDir);
  assert.equal(result.ok, false);
  const statusErr = result.details.find((d) => d.field === "status" && d.level === "error");
  assert.ok(statusErr, "should report missing status field");
});

test("invalid status enum reports error", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/bad-status.md": makeBacklogItem({ status: "yolo" }),
  });
  t.after(cleanup);

  const result = runValidate(pmDir);
  assert.equal(result.ok, false);
  const err = result.details.find((d) => d.field === "status");
  assert.ok(err);
  assert.ok(err.message.includes("yolo"));
});

test("invalid priority enum reports error", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/bad-prio.md": makeBacklogItem({ priority: "urgent" }),
  });
  t.after(cleanup);

  const result = runValidate(pmDir);
  assert.equal(result.ok, false);
  const err = result.details.find((d) => d.field === "priority");
  assert.ok(err);
  assert.ok(err.message.includes("urgent"));
});

test("invalid ID format reports error", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/bad-id.md": makeBacklogItem({ id: "ISSUE-1" }),
  });
  t.after(cleanup);

  const result = runValidate(pmDir);
  assert.equal(result.ok, false);
  const err = result.details.find((d) => d.field === "id");
  assert.ok(err);
  assert.ok(err.message.includes("ISSUE-1"));
});

test("duplicate IDs report error", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/item-a.md": makeBacklogItem({ id: "PM-001", title: "First" }),
    "pm/backlog/item-b.md": makeBacklogItem({ id: "PM-001", title: "Duplicate" }),
  });
  t.after(cleanup);

  const result = runValidate(pmDir);
  assert.equal(result.ok, false);
  const err = result.details.find((d) => d.message.includes("duplicate"));
  assert.ok(err, "should report duplicate ID");
});

test("ID gaps produce warnings", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/item-a.md": makeBacklogItem({ id: "PM-001" }),
    "pm/backlog/item-c.md": makeBacklogItem({ id: "PM-003" }),
  });
  t.after(cleanup);

  const result = runValidate(pmDir);
  assert.equal(result.ok, true, "gaps are warnings, not errors");
  const warn = result.details.find((d) => d.level === "warning" && d.message.includes("PM-002"));
  assert.ok(warn, "should warn about PM-002 gap");
});

test("broken parent reference produces warning", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/child.md": makeBacklogItem({ id: "PM-001", parent: "nonexistent-parent" }),
  });
  t.after(cleanup);

  const result = runValidate(pmDir);
  assert.equal(result.ok, true, "broken refs are warnings, not errors");
  const warn = result.details.find((d) => d.level === "warning" && d.field === "parent");
  assert.ok(warn, "should warn about missing parent");
});

test("broken children reference produces warning", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/parent.md": makeBacklogItem({ id: "PM-001", children: ["ghost-child"] }),
  });
  t.after(cleanup);

  const result = runValidate(pmDir);
  assert.equal(result.ok, true, "broken refs are warnings, not errors");
  const warn = result.details.find((d) => d.level === "warning" && d.field === "children");
  assert.ok(warn, "should warn about missing child");
});

test("invalid date format reports error", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/bad-date.md": makeBacklogItem({ created: "March 14" }),
  });
  t.after(cleanup);

  const result = runValidate(pmDir);
  assert.equal(result.ok, false);
  const err = result.details.find((d) => d.field === "created");
  assert.ok(err);
  assert.ok(err.message.includes("March 14"));
});

test("strategy.md with wrong type reports error", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/strategy.md": "---\ntype: oops\n---\n\n# Strategy\n",
  });
  t.after(cleanup);

  const result = runValidate(pmDir);
  assert.equal(result.ok, false);
  const err = result.details.find((d) => d.file === "strategy.md");
  assert.ok(err);
});

test("valid optional enum fields pass", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/full.md": makeBacklogItem({
      evidence_strength: "strong",
      scope_signal: "small",
      competitor_gap: "unique",
    }),
  });
  t.after(cleanup);

  const result = runValidate(pmDir);
  assert.equal(result.ok, true);
  assert.equal(result.errors, 0);
});

test("no frontmatter reports error", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/no-fm.md": "# Just a heading\n\nNo frontmatter here.\n",
  });
  t.after(cleanup);

  const result = runValidate(pmDir);
  assert.equal(result.ok, false);
  const err = result.details.find((d) => d.message.includes("no YAML frontmatter"));
  assert.ok(err);
});

test("valid KB insight and evidence files pass validation", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/insights/business/reporting-gaps.md": makeInsight(),
    "pm/insights/business/index.md": makeIndex([
      "| [reporting-gaps.md](reporting-gaps.md) | Export pain clusters | 2026-04-06 | active |",
    ]),
    "pm/insights/business/log.md": makeLog([
      "2026-04-06 create insights/business/reporting-gaps.md",
    ]),
    "pm/evidence/research/reporting-gaps.md": makeEvidence(),
    "pm/evidence/research/index.md": makeIndex([
      "| [reporting-gaps.md](reporting-gaps.md) | Source notes | 2026-04-06 | active |",
    ]),
    "pm/evidence/research/log.md": makeLog([
      "2026-04-06 cite insights/business/reporting-gaps.md -> evidence/research/reporting-gaps.md",
    ]),
  });
  t.after(cleanup);

  const result = runValidate(pmDir);
  assert.equal(result.ok, true, JSON.stringify(result.details, null, 2));
});

test("insight validation rejects scalar sources and pm-prefixed paths", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/insights/business/reporting-gaps.md": makeFrontmatterDocument(
      {
        type: "insight",
        domain: "business",
        topic: "Reporting gaps",
        last_updated: "2026-04-06",
        status: "active",
        confidence: "medium",
        sources: "pm/evidence/research/reporting-gaps.md",
      },
      "Reporting gaps"
    ),
  });
  t.after(cleanup);

  const result = runValidate(pmDir);
  assert.equal(result.ok, false);
  assert.ok(result.details.some((d) => d.file.includes("insights/business/reporting-gaps.md")));
});

test("insight validation rejects domain mismatch and bad source targets", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/insights/business/reporting-gaps.md": makeInsight({
      domain: "product",
      sources: ["insights/business/not-evidence.md"],
    }),
  });
  t.after(cleanup);

  const result = runValidate(pmDir);
  assert.equal(result.ok, false);
  assert.ok(result.details.some((d) => d.field === "domain"));
  assert.ok(result.details.some((d) => d.field === "sources"));
});

test("evidence validation rejects folder/type mismatch and scalar cited_by", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/evidence/research/reporting-gaps.md": makeFrontmatterDocument(
      {
        type: "evidence",
        evidence_type: "user-feedback",
        source_origin: "external",
        created: "2026-04-06",
        sources: ["https://example.com/report.pdf"],
        cited_by: "insights/business/reporting-gaps.md",
      },
      "Reporting gaps source"
    ),
  });
  t.after(cleanup);

  const result = runValidate(pmDir);
  assert.equal(result.ok, false);
  assert.ok(result.details.some((d) => d.field === "evidence_type"));
  assert.ok(result.details.some((d) => d.field === "cited_by"));
});

test("index validation requires one row per content file", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/insights/business/reporting-gaps.md": makeInsight(),
    "pm/insights/business/retention.md": makeInsight({
      topic: "Retention gaps",
      sources: ["evidence/research/retention.md"],
    }),
    "pm/insights/business/index.md": makeIndex([
      "| [reporting-gaps.md](reporting-gaps.md) | Export pain clusters | 2026-04-06 | active |",
    ]),
    "pm/evidence/research/reporting-gaps.md": makeEvidence(),
    "pm/evidence/research/retention.md": makeEvidence({
      cited_by: ["insights/business/retention.md"],
    }),
  });
  t.after(cleanup);

  const result = runValidate(pmDir);
  assert.equal(result.ok, false);
  assert.ok(result.details.some((d) => d.message.includes('missing index row for "retention.md"')));
});

test("log validation rejects malformed lines", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/insights/business/reporting-gaps.md": makeInsight(),
    "pm/insights/business/index.md": makeIndex([
      "| [reporting-gaps.md](reporting-gaps.md) | Export pain clusters | 2026-04-06 | active |",
    ]),
    "pm/insights/business/log.md": makeLog([
      "2026-04-06 create insights/business/reporting-gaps.md",
      "2026-04-06 cite insights/business/reporting-gaps.md evidence/research/reporting-gaps.md",
    ]),
    "pm/evidence/research/reporting-gaps.md": makeEvidence(),
  });
  t.after(cleanup);

  const result = runValidate(pmDir);
  assert.equal(result.ok, false);
  assert.ok(result.details.some((d) => d.file.endsWith("log.md")));
});

test("bidirectional citation validation rejects missing reciprocal links", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/insights/business/reporting-gaps.md": makeInsight(),
    "pm/evidence/research/reporting-gaps.md": makeEvidence({ cited_by: [] }),
  });
  t.after(cleanup);

  const result = runValidate(pmDir);
  assert.equal(result.ok, false);
  assert.ok(result.details.some((d) => d.message.includes("does not cite")));
});

test("bidirectional citation validation rejects missing target files", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/insights/business/reporting-gaps.md": makeInsight(),
  });
  t.after(cleanup);

  const result = runValidate(pmDir);
  assert.equal(result.ok, false);
  assert.ok(
    result.details.some((d) =>
      d.message.includes('missing evidence file "evidence/research/reporting-gaps.md"')
    )
  );
});

// ---------------------------------------------------------------------------
// PM-150: Artifact traceability — status lifecycle & type validation
// ---------------------------------------------------------------------------

test("PM-150: proposed status passes validation", () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/proposed-item.md": makeBacklogItem({ status: "proposed" }),
  });
  try {
    const result = runValidate(pmDir);
    assert.equal(result.ok, true, `proposed status should pass: ${JSON.stringify(result.details)}`);
  } finally {
    cleanup();
  }
});

test("PM-150: planned status passes validation", () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/planned-item.md": makeBacklogItem({ status: "planned" }),
  });
  try {
    const result = runValidate(pmDir);
    assert.equal(result.ok, true, `planned status should pass: ${JSON.stringify(result.details)}`);
  } finally {
    cleanup();
  }
});

test("PM-150: approved status is rejected by validation", () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/approved-item.md": makeBacklogItem({ status: "approved" }),
  });
  try {
    const result = runValidate(pmDir);
    assert.equal(result.ok, false, "approved status should fail validation");
    assert.ok(
      result.details.some((d) => d.message.includes("approved")),
      "error message must mention approved"
    );
  } finally {
    cleanup();
  }
});

test("PM-150: type proposal passes validation", () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/proposal-item.md": makeBacklogItem({ type: "proposal" }),
  });
  try {
    const result = runValidate(pmDir);
    assert.equal(result.ok, true, `type proposal should pass: ${JSON.stringify(result.details)}`);
  } finally {
    cleanup();
  }
});

test("PM-150: frontmatter parser handles prs YAML list with quoted # values", () => {
  const { parseFrontmatter } = require("../scripts/kb-frontmatter.js");
  const content = [
    "---",
    "type: backlog-issue",
    "prs:",
    '  - "#42"',
    '  - "#43"',
    "linear_id: LIN-442",
    "thinking: thinking/my-feature.md",
    "---",
    "",
    "# Test",
  ].join("\n");
  const { data } = parseFrontmatter(content);
  assert.deepEqual(data.prs, ["#42", "#43"], "prs must parse as array with # values");
  assert.equal(data.linear_id, "LIN-442", "linear_id must parse as scalar");
  assert.equal(data.thinking, "thinking/my-feature.md", "thinking must parse as scalar");
});

test("real pm/ directory passes validation", (t) => {
  const realPmDir = path.join(__dirname, "..", "pm");
  if (!fs.existsSync(realPmDir)) {
    t.skip("no pm/ directory in repo");
    return;
  }
  const result = runValidate(realPmDir);
  assert.equal(result.ok, true, `validation failed: ${JSON.stringify(result.details)}`);
});
