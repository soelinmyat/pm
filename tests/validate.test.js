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
    type: "backlog",
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
    "pm/backlog/bad-id.md": makeBacklogItem({ id: "bad-format" }),
  });
  t.after(cleanup);

  const result = runValidate(pmDir);
  assert.equal(result.ok, false);
  const err = result.details.find((d) => d.field === "id");
  assert.ok(err);
  assert.ok(err.message.includes("bad-format"));
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
// Notes validation (type: notes)
// ---------------------------------------------------------------------------

test("valid notes file passes validation", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/evidence/notes/2026-04.md": makeFrontmatterDocument(
      {
        type: "notes",
        month: "2026-04",
        updated: "2026-04-09",
        note_count: 2,
        digested_through: "null",
      },
      "Notes"
    ),
  });
  t.after(cleanup);

  const result = runValidate(pmDir);
  assert.equal(result.ok, true, `should pass: ${JSON.stringify(result.details)}`);
});

test("notes file missing required fields reports errors", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/evidence/notes/2026-04.md": makeFrontmatterDocument(
      {
        type: "notes",
      },
      "Notes"
    ),
  });
  t.after(cleanup);

  const result = runValidate(pmDir);
  assert.equal(result.ok, false);
  assert.ok(
    result.details.some((d) => d.field === "month"),
    "should report missing month"
  );
  assert.ok(
    result.details.some((d) => d.field === "updated"),
    "should report missing updated"
  );
  assert.ok(
    result.details.some((d) => d.field === "note_count"),
    "should report missing note_count"
  );
  assert.ok(
    result.details.some((d) => d.field === "digested_through"),
    "should report missing digested_through"
  );
});

test("notes file with invalid month format reports error", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/evidence/notes/2026-04.md": makeFrontmatterDocument(
      {
        type: "notes",
        month: "April 2026",
        updated: "2026-04-09",
        note_count: 2,
        digested_through: "null",
      },
      "Notes"
    ),
  });
  t.after(cleanup);

  const result = runValidate(pmDir);
  assert.equal(result.ok, false);
  assert.ok(
    result.details.some((d) => d.field === "month" && d.message.includes("April 2026")),
    "should report invalid month format"
  );
});

test("notes file with wrong type is not validated as notes", (t) => {
  // A file with type: evidence in notes/ should fail evidence validation, not notes validation
  const { pmDir, cleanup } = withPmDir({
    "pm/evidence/notes/2026-04.md": makeFrontmatterDocument(
      {
        type: "evidence",
        evidence_type: "notes",
        source_origin: "internal",
        created: "2026-04-09",
        sources: [],
        cited_by: [],
      },
      "Notes"
    ),
  });
  t.after(cleanup);

  const result = runValidate(pmDir);
  // Should not crash — it should validate as an evidence file
  assert.ok(result, "should return a result");
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

test("PM-199: item without type reports error", () => {
  const { pmDir, cleanup } = withPmDir({});
  // Manually create a backlog item without type field
  const filePath = path.join(pmDir, "backlog", "no-type-item.md");
  const content = [
    "---",
    "id: PM-001",
    "title: Test item",
    "outcome: Something happens",
    "status: idea",
    "priority: medium",
    'parent: "null"',
    "children: []",
    "created: 2026-03-14",
    "updated: 2026-03-14",
    "---",
    "",
    "## Outcome",
    "",
    "Test outcome.",
  ].join("\n");
  fs.writeFileSync(filePath, content);
  try {
    const result = runValidate(pmDir);
    assert.equal(result.ok, false, "missing type should fail");
    assert.ok(
      result.details.some((d) => d.field === "type" && d.level === "error"),
      "should report missing type field"
    );
  } finally {
    cleanup();
  }
});

test("PM-199: legacy type 'backlog-issue' passes with deprecation warning", () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/typed-item.md": makeBacklogItem({ type: "backlog-issue" }),
  });
  try {
    const result = runValidate(pmDir);
    assert.equal(
      result.ok,
      true,
      `legacy type should pass (warning, not error): ${JSON.stringify(result.details)}`
    );
    assert.ok(
      result.details.some(
        (d) => d.level === "warning" && d.field === "type" && d.message.includes("deprecated")
      ),
      "should warn about deprecated type"
    );
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

// ---------------------------------------------------------------------------
// PM-154: Insight synthesis — validator prerequisites
// ---------------------------------------------------------------------------

test("PM-154: mixed source_origin is accepted", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/evidence/research/mixed-topic.md": makeEvidence({
      source_origin: "mixed",
      cited_by: [],
    }),
    "pm/evidence/research/index.md": makeIndex([
      "| [mixed-topic.md](mixed-topic.md) | Mixed topic | 2026-04-09 | active |",
    ]),
    "pm/evidence/research/log.md": makeLog(["2026-04-09 create evidence/research/mixed-topic.md"]),
  });
  t.after(cleanup);
  const result = runValidate(pmDir);
  assert.equal(result.ok, true, `mixed origin should pass: ${JSON.stringify(result.details)}`);
});

test("PM-154: object-style sources with url and accessed are accepted", (t) => {
  const doc = [
    "---",
    "type: evidence",
    "evidence_type: research",
    "source_origin: external",
    "created: 2026-04-09",
    "sources:",
    "  - url: https://example.com/article",
    "    accessed: 2026-04-09",
    "cited_by: []",
    "---",
    "",
    "# Object sources test",
  ].join("\n");
  const { pmDir, cleanup } = withPmDir({
    "pm/evidence/research/obj-sources.md": doc,
    "pm/evidence/research/index.md": makeIndex([
      "| [obj-sources.md](obj-sources.md) | Object sources | 2026-04-09 | active |",
    ]),
    "pm/evidence/research/log.md": makeLog(["2026-04-09 create evidence/research/obj-sources.md"]),
  });
  t.after(cleanup);
  const result = runValidate(pmDir);
  assert.equal(result.ok, true, `object sources should pass: ${JSON.stringify(result.details)}`);
});

test("PM-154: object-style source without url property is rejected", (t) => {
  const doc = [
    "---",
    "type: evidence",
    "evidence_type: research",
    "source_origin: external",
    "created: 2026-04-09",
    "sources:",
    "  - accessed: 2026-04-09",
    "cited_by: []",
    "---",
    "",
    "# Bad object source",
  ].join("\n");
  const { pmDir, cleanup } = withPmDir({
    "pm/evidence/research/bad-obj.md": doc,
    "pm/evidence/research/index.md": makeIndex([
      "| [bad-obj.md](bad-obj.md) | Bad obj | 2026-04-09 | active |",
    ]),
    "pm/evidence/research/log.md": makeLog(["2026-04-09 create evidence/research/bad-obj.md"]),
  });
  t.after(cleanup);
  const result = runValidate(pmDir);
  assert.equal(result.ok, false);
  assert.ok(result.details.some((d) => d.field === "sources"));
});

test("PM-154: skip log action is accepted", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/insights/business/reporting-gaps.md": makeInsight(),
    "pm/insights/business/index.md": makeIndex([
      "| [reporting-gaps.md](reporting-gaps.md) | Export pain clusters | 2026-04-06 | active |",
    ]),
    "pm/insights/business/log.md": makeLog([
      "2026-04-06 create insights/business/reporting-gaps.md",
      "2026-04-09 skip reason: no match for evidence/research/some-topic.md",
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
  assert.equal(result.ok, true, `skip log action should pass: ${JSON.stringify(result.details)}`);
});

test("PM-154: bidirectional insight-evidence citation passes", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/insights/product/index.md": makeIndex([
      "| [test-topic.md](test-topic.md) | Test Topic | 2026-04-09 | active |",
    ]),
    "pm/insights/product/log.md": makeLog(["2026-04-09 create insights/product/test-topic.md"]),
    "pm/insights/product/test-topic.md": makeInsight({
      domain: "product",
      topic: "Test Topic",
      sources: ["evidence/research/test-source.md"],
    }),
    "pm/evidence/research/test-source.md": makeEvidence({
      cited_by: ["insights/product/test-topic.md"],
    }),
    "pm/evidence/research/index.md": makeIndex([
      "| [test-source.md](test-source.md) | Source notes | 2026-04-09 | active |",
    ]),
    "pm/evidence/research/log.md": makeLog([
      "2026-04-09 cite insights/product/test-topic.md -> evidence/research/test-source.md",
    ]),
  });
  t.after(cleanup);
  const result = runValidate(pmDir);
  assert.equal(
    result.ok,
    true,
    `bidirectional citation should pass: ${JSON.stringify(result.details)}`
  );
});

test("PM-154: mismatched citation pair fails validation", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/insights/product/index.md": makeIndex([
      "| [test-topic.md](test-topic.md) | Test Topic | 2026-04-09 | active |",
    ]),
    "pm/insights/product/log.md": makeLog(["2026-04-09 create insights/product/test-topic.md"]),
    "pm/insights/product/test-topic.md": makeInsight({
      domain: "product",
      topic: "Test Topic",
      sources: ["evidence/research/test-source.md"],
    }),
    "pm/evidence/research/test-source.md": makeEvidence({
      cited_by: [],
    }),
    "pm/evidence/research/index.md": makeIndex([
      "| [test-source.md](test-source.md) | Source notes | 2026-04-09 | active |",
    ]),
    "pm/evidence/research/log.md": makeLog(["2026-04-09 create evidence/research/test-source.md"]),
  });
  t.after(cleanup);
  const result = runValidate(pmDir);
  assert.equal(result.ok, false);
  assert.ok(result.details.some((d) => d.message.includes("does not cite")));
});

test("PM-154: insight with empty sources passes validation (seeded files)", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/insights/product/index.md": makeIndex([
      "| [seeded-topic.md](seeded-topic.md) | Seeded Topic | 2026-04-09 | draft |",
    ]),
    "pm/insights/product/log.md": makeLog(["2026-04-09 create insights/product/seeded-topic.md"]),
    "pm/insights/product/seeded-topic.md": makeInsight({
      domain: "product",
      topic: "Seeded Topic",
      status: "draft",
      confidence: "low",
      sources: [],
    }),
  });
  t.after(cleanup);
  const result = runValidate(pmDir);
  assert.equal(result.ok, true, `empty sources should pass: ${JSON.stringify(result.details)}`);
});

// ---- pm/product/features.md schema validation ----

test("valid pm/product/features.md passes validation", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/product/features.md": [
      "---",
      "generated: 2026-04-11",
      "source_project: my-app",
      "files_scanned: 42",
      "feature_count: 2",
      "area_count: 1",
      "areas:",
      '  - name: "Core"',
      "    features:",
      '      - "structured-discovery"',
      '      - "evidence-routing"',
      "---",
      "",
      "## Core",
      "",
      "### Structured discovery",
      "A multi-phase grooming pipeline.",
      "",
      "### Evidence routing",
      "Routes evidence into insight topics.",
      "",
    ].join("\n"),
  });
  t.after(cleanup);
  const result = runValidate(pmDir);
  assert.equal(result.ok, true, `valid features.md should pass: ${JSON.stringify(result.details)}`);
});

test("pm/product/features.md missing generated field fails validation", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/product/features.md": [
      "---",
      "source_project: my-app",
      "files_scanned: 42",
      "feature_count: 1",
      "area_count: 1",
      "areas:",
      '  - name: "Core"',
      "    features:",
      '      - "some-feature"',
      "---",
      "",
      "## Core",
      "",
      "### Some feature",
      "Description.",
      "",
    ].join("\n"),
  });
  t.after(cleanup);
  const result = runValidate(pmDir);
  assert.equal(result.ok, false);
  assert.ok(result.details.some((d) => d.field === "generated"));
});

test("pm/product/features.md feature_count mismatch with h3 count fails validation", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/product/features.md": [
      "---",
      "generated: 2026-04-11",
      "source_project: my-app",
      "files_scanned: 42",
      "feature_count: 5",
      "area_count: 1",
      "areas:",
      '  - name: "Core"',
      "    features:",
      '      - "one-feature"',
      "---",
      "",
      "## Core",
      "",
      "### One feature",
      "Description.",
      "",
    ].join("\n"),
  });
  t.after(cleanup);
  const result = runValidate(pmDir);
  assert.equal(result.ok, false);
  assert.ok(result.details.some((d) => d.field === "feature_count"));
});

test("pm/product/features.md empty areas array fails validation", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/product/features.md": [
      "---",
      "generated: 2026-04-11",
      "source_project: my-app",
      "files_scanned: 42",
      "feature_count: 0",
      "area_count: 0",
      "areas: []",
      "---",
      "",
      "No features.",
      "",
    ].join("\n"),
  });
  t.after(cleanup);
  const result = runValidate(pmDir);
  assert.equal(result.ok, false);
  assert.ok(result.details.some((d) => d.field === "areas"));
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

// ---------------------------------------------------------------------------
// PM-170 Issue 3: Plugin registration — commands, agents, stale references
// ---------------------------------------------------------------------------

test("PM-170: plugin.config.json has exactly 13 commands (no merge, no features, has note, sync, and ideate)", () => {
  const configPath = path.join(__dirname, "..", "plugin.config.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

  const expected = [
    "dev",
    "groom",
    "ideate",
    "ingest",
    "note",
    "refresh",
    "research",
    "setup",
    "ship",
    "start",
    "strategy",
    "sync",
    "think",
  ];

  assert.deepEqual(
    [...config.commands].sort(),
    [...expected].sort(),
    `Expected commands: ${expected.join(", ")}. Got: ${config.commands.join(", ")}`
  );

  assert.ok(!config.commands.includes("merge"), "merge command must be removed");
  assert.ok(!config.commands.includes("features"), "features command must be removed");
  assert.ok(config.commands.includes("note"), "note command must be present");
  assert.ok(config.commands.includes("sync"), "sync command must be present");
});

test("PM-170: plugin.config.json has 0 agents", () => {
  const configPath = path.join(__dirname, "..", "plugin.config.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

  // agents key should not exist or be an empty array
  if (config.agents) {
    assert.equal(config.agents.length, 0, "agents array must be empty");
  }
});

test("PM-170: agents/ directory does not exist or is empty", () => {
  const agentsDir = path.join(__dirname, "..", "agents");
  if (fs.existsSync(agentsDir)) {
    const files = fs.readdirSync(agentsDir).filter((f) => f.endsWith(".md"));
    assert.equal(files.length, 0, `agents/ should be empty, found: ${files.join(", ")}`);
  }
  // If directory doesn't exist, that's also valid
});

test("PM-170: no stale agent names in skill files", () => {
  const staleAgentNames = [
    "code-reviewer",
    "edge-case-tester",
    "engineering-manager",
    "system-architect",
    "integration-engineer",
    "design-director",
    "qa-lead",
    "design-system-lead",
    "design-reviewer",
    "product-director",
    "qa-tester",
    "test-engineer",
    "ux-designer",
    "design-qa",
    "associate-pm",
  ];

  const skillDirs = [
    path.join(__dirname, "..", "skills"),
    path.join(__dirname, "..", "references"),
  ];

  const violations = [];

  function scanDir(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath);
      } else if (entry.name.endsWith(".md")) {
        const content = fs.readFileSync(fullPath, "utf8");
        for (const agent of staleAgentNames) {
          // Match pm:agent-name pattern (the old intent labels)
          const pattern = `pm:${agent}`;
          if (content.includes(pattern)) {
            violations.push(
              `${path.relative(path.join(__dirname, ".."), fullPath)}: contains "${pattern}"`
            );
          }
        }
      }
    }
  }

  for (const dir of skillDirs) {
    scanDir(dir);
  }

  assert.equal(violations.length, 0, `Found stale agent references:\n  ${violations.join("\n  ")}`);
});

// ---------------------------------------------------------------------------
// PM-149: Memory file validation (pm/memory.md, pm/memory-archive.md)
// ---------------------------------------------------------------------------

function makeMemoryFile(entries, overrides = {}) {
  const data = {
    type: "project-memory",
    created: "2026-03-20",
    updated: "2026-04-04",
    ...overrides,
  };
  let fm = "---\n";
  for (const [key, value] of Object.entries(data)) {
    fm += `${key}: ${value}\n`;
  }
  fm += "entries:\n";
  for (const entry of entries) {
    fm += `  - date: ${entry.date || "2026-04-04"}\n`;
    fm += `    source: ${entry.source || "retro"}\n`;
    fm += `    category: ${entry.category || "process"}\n`;
    fm += `    learning: "${entry.learning || "test learning"}"\n`;
    if (entry.detail !== undefined) {
      fm += `    detail: "${entry.detail}"\n`;
    }
    if (entry.pinned !== undefined) {
      fm += `    pinned: ${entry.pinned}\n`;
    }
  }
  fm += "---\n\n# Project Memory\n";
  return fm;
}

function makeMemoryArchiveFile(entries, overrides = {}) {
  const data = {
    type: "project-memory-archive",
    created: "2026-03-20",
    updated: "2026-04-04",
    ...overrides,
  };
  let fm = "---\n";
  for (const [key, value] of Object.entries(data)) {
    fm += `${key}: ${value}\n`;
  }
  fm += "entries:\n";
  for (const entry of entries) {
    fm += `  - date: ${entry.date || "2026-04-04"}\n`;
    fm += `    source: ${entry.source || "retro"}\n`;
    fm += `    category: ${entry.category || "process"}\n`;
    fm += `    learning: "${entry.learning || "archived learning"}"\n`;
    if (entry.detail !== undefined) {
      fm += `    detail: "${entry.detail}"\n`;
    }
    if (entry.pinned !== undefined) {
      fm += `    pinned: ${entry.pinned}\n`;
    }
    fm += `    archived_at: ${entry.archived_at || "2026-04-10"}\n`;
  }
  fm += "---\n\n# Memory Archive\n";
  return fm;
}

test("PM-149: valid memory.md passes validation", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/memory.md": makeMemoryFile([
      { date: "2026-04-04", source: "retro", category: "process", learning: "test learning" },
    ]),
  });
  t.after(cleanup);

  const result = runValidate(pmDir);
  assert.equal(result.ok, true, `valid memory.md should pass: ${JSON.stringify(result.details)}`);
});

test("PM-149: memory.md with optional detail and pinned fields passes", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/memory.md": makeMemoryFile([
      {
        date: "2026-04-04",
        source: "retro",
        category: "scope",
        learning: "always check scope",
        detail: "expanded context here",
        pinned: true,
      },
    ]),
  });
  t.after(cleanup);

  const result = runValidate(pmDir);
  assert.equal(result.ok, true, `optional fields should pass: ${JSON.stringify(result.details)}`);
});

test("PM-149: memory.md missing required entry field reports error", (t) => {
  // Create a memory file with an entry missing the 'source' field
  const content = [
    "---",
    "type: project-memory",
    "created: 2026-03-20",
    "updated: 2026-04-04",
    "entries:",
    "  - date: 2026-04-04",
    "    category: process",
    '    learning: "missing source field"',
    "---",
    "",
    "# Project Memory",
  ].join("\n");

  const { pmDir, cleanup } = withPmDir({ "pm/memory.md": content });
  t.after(cleanup);

  const result = runValidate(pmDir);
  assert.equal(result.ok, false);
  assert.ok(
    result.details.some((d) => d.message.includes("source")),
    "should report missing source field"
  );
});

test("PM-149: memory.md with invalid pinned type reports error", (t) => {
  const content = [
    "---",
    "type: project-memory",
    "created: 2026-03-20",
    "updated: 2026-04-04",
    "entries:",
    "  - date: 2026-04-04",
    "    source: retro",
    "    category: process",
    '    learning: "test"',
    '    pinned: "yes"',
    "---",
    "",
    "# Project Memory",
  ].join("\n");

  const { pmDir, cleanup } = withPmDir({ "pm/memory.md": content });
  t.after(cleanup);

  const result = runValidate(pmDir);
  assert.equal(result.ok, false);
  assert.ok(
    result.details.some((d) => d.message.includes("pinned")),
    "should report invalid pinned type"
  );
});

test("PM-149: memory.md with wrong type reports error", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/memory.md": makeMemoryFile(
      [{ date: "2026-04-04", source: "retro", category: "process", learning: "test" }],
      { type: "wrong-type" }
    ),
  });
  t.after(cleanup);

  const result = runValidate(pmDir);
  assert.equal(result.ok, false);
  assert.ok(
    result.details.some((d) => d.message.includes("project-memory")),
    "should report wrong type"
  );
});

test("PM-149: missing memory.md is OK (not all projects have it)", (t) => {
  const { pmDir, cleanup } = withPmDir({});
  t.after(cleanup);

  const result = runValidate(pmDir);
  assert.equal(result.ok, true, `missing memory.md should pass: ${JSON.stringify(result.details)}`);
});

test("PM-149: valid memory-archive.md passes validation", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/memory-archive.md": makeMemoryArchiveFile([
      {
        date: "2026-03-20",
        source: "retro",
        category: "quality",
        learning: "archived learning",
        archived_at: "2026-04-10",
      },
    ]),
  });
  t.after(cleanup);

  const result = runValidate(pmDir);
  assert.equal(
    result.ok,
    true,
    `valid memory-archive.md should pass: ${JSON.stringify(result.details)}`
  );
});

test("PM-149: memory-archive.md entry missing archived_at reports error", (t) => {
  const content = [
    "---",
    "type: project-memory-archive",
    "created: 2026-03-20",
    "updated: 2026-04-04",
    "entries:",
    "  - date: 2026-04-04",
    "    source: retro",
    "    category: process",
    '    learning: "archived but no timestamp"',
    "---",
    "",
    "# Memory Archive",
  ].join("\n");

  const { pmDir, cleanup } = withPmDir({ "pm/memory-archive.md": content });
  t.after(cleanup);

  const result = runValidate(pmDir);
  assert.equal(result.ok, false);
  assert.ok(
    result.details.some((d) => d.message.includes("archived_at")),
    "should report missing archived_at"
  );
});

// ---------------------------------------------------------------------------
// PM-199 Issue 2: Backlog type validation, competitor sub-type, validate() export
// ---------------------------------------------------------------------------

test("PM-199: canonical type 'backlog' passes validation", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/good-type.md": makeBacklogItem({ type: "backlog" }),
  });
  t.after(cleanup);
  const result = runValidate(pmDir);
  assert.equal(result.ok, true, `canonical type should pass: ${JSON.stringify(result.details)}`);
  assert.equal(result.warnings, 0, "no warnings for canonical type");
});

test("PM-199: all legacy backlog types produce deprecation warnings", () => {
  const legacyTypes = ["backlog-issue", "proposal", "idea", "notes"];
  for (const legacyType of legacyTypes) {
    const { pmDir, cleanup } = withPmDir({
      "pm/backlog/legacy.md": makeBacklogItem({ type: legacyType }),
    });
    const result = runValidate(pmDir);
    assert.equal(result.ok, true, `legacy type "${legacyType}" should not produce errors`);
    assert.ok(
      result.details.some(
        (d) => d.level === "warning" && d.field === "type" && d.message.includes("deprecated")
      ),
      `"${legacyType}" should produce a deprecation warning`
    );
    cleanup();
  }
});

test("PM-199: invalid backlog type produces error", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/bad-type.md": makeBacklogItem({ type: "unknown-type" }),
  });
  t.after(cleanup);
  const result = runValidate(pmDir);
  assert.equal(result.ok, false);
  assert.ok(
    result.details.some(
      (d) => d.level === "error" && d.field === "type" && d.message.includes("unknown-type")
    ),
    "should report invalid backlog type"
  );
});

test("PM-199: labels as non-empty array passes validation", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/with-labels.md": makeBacklogItem({ labels: ["ux", "mvp"] }),
  });
  t.after(cleanup);
  const result = runValidate(pmDir);
  assert.equal(result.ok, true, `valid labels should pass: ${JSON.stringify(result.details)}`);
});

test("PM-199: empty labels array produces error", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/empty-labels.md": makeBacklogItem({ labels: [] }),
  });
  t.after(cleanup);
  const result = runValidate(pmDir);
  assert.equal(result.ok, false);
  assert.ok(
    result.details.some((d) => d.field === "labels" && d.message.includes("non-empty")),
    "should report empty labels"
  );
});

test("PM-199: valid competitor-profile passes validation", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/evidence/competitors/acme/profile.md": makeFrontmatterDocument(
      {
        type: "competitor-profile",
        company: "Acme Corp",
        slug: "acme",
        profiled: "2026-04-10",
        sources: ["https://acme.com"],
      },
      "Acme Corp Profile"
    ),
  });
  t.after(cleanup);
  const result = runValidate(pmDir);
  assert.equal(result.ok, true, `valid competitor should pass: ${JSON.stringify(result.details)}`);
});

test("PM-199: competitor missing required fields reports errors", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/evidence/competitors/acme/profile.md": makeFrontmatterDocument(
      {
        type: "competitor-profile",
      },
      "Acme Corp Profile"
    ),
  });
  t.after(cleanup);
  const result = runValidate(pmDir);
  assert.equal(result.ok, false);
  assert.ok(
    result.details.some((d) => d.field === "company"),
    "should report missing company"
  );
  assert.ok(
    result.details.some((d) => d.field === "slug"),
    "should report missing slug"
  );
  assert.ok(
    result.details.some((d) => d.field === "profiled"),
    "should report missing profiled"
  );
  assert.ok(
    result.details.some((d) => d.field === "sources"),
    "should report missing sources"
  );
});

test("PM-199: competitor slug mismatch reports error", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/evidence/competitors/acme/profile.md": makeFrontmatterDocument(
      {
        type: "competitor-profile",
        company: "Acme Corp",
        slug: "wrong-slug",
        profiled: "2026-04-10",
        sources: ["https://acme.com"],
      },
      "Acme Corp Profile"
    ),
  });
  t.after(cleanup);
  const result = runValidate(pmDir);
  assert.equal(result.ok, false);
  assert.ok(
    result.details.some(
      (d) => d.field === "slug" && d.message.includes("does not match parent directory")
    ),
    "should report slug mismatch"
  );
});

test("PM-199: competitor invalid profiled date reports error", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/evidence/competitors/acme/profile.md": makeFrontmatterDocument(
      {
        type: "competitor-profile",
        company: "Acme Corp",
        slug: "acme",
        profiled: "April 2026",
        sources: ["https://acme.com"],
      },
      "Acme Corp Profile"
    ),
  });
  t.after(cleanup);
  const result = runValidate(pmDir);
  assert.equal(result.ok, false);
  assert.ok(
    result.details.some((d) => d.field === "profiled" && d.message.includes("YYYY-MM-DD")),
    "should report invalid date"
  );
});

test("PM-199: invalid competitor type reports error", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/evidence/competitors/acme/bad.md": makeFrontmatterDocument(
      {
        type: "competitor-unknown",
        company: "Acme Corp",
        slug: "acme",
        profiled: "2026-04-10",
        sources: ["https://acme.com"],
      },
      "Acme Corp Bad"
    ),
  });
  t.after(cleanup);
  const result = runValidate(pmDir);
  assert.equal(result.ok, false);
  assert.ok(
    result.details.some((d) => d.field === "type" && d.message.includes("competitor-unknown")),
    "should report invalid competitor type"
  );
});

test("PM-199: all valid competitor sub-types pass", () => {
  const subTypes = [
    "competitor-profile",
    "competitor-features",
    "competitor-sentiment",
    "competitor-api",
    "competitor-seo",
  ];
  for (const subType of subTypes) {
    const { pmDir, cleanup } = withPmDir({
      "pm/evidence/competitors/acme/artifact.md": makeFrontmatterDocument(
        {
          type: subType,
          company: "Acme Corp",
          slug: "acme",
          profiled: "2026-04-10",
          sources: ["https://acme.com"],
        },
        "Acme Corp"
      ),
    });
    const result = runValidate(pmDir);
    assert.equal(
      result.ok,
      true,
      `sub-type "${subType}" should pass: ${JSON.stringify(result.details)}`
    );
    cleanup();
  }
});

test("PM-199: competitor file is not rejected as invalid evidence type", (t) => {
  // Competitor files must NOT be routed through validateEvidenceFile which would
  // reject them with 'expected "evidence", got "competitor-profile"'
  const { pmDir, cleanup } = withPmDir({
    "pm/evidence/competitors/acme/profile.md": makeFrontmatterDocument(
      {
        type: "competitor-profile",
        company: "Acme Corp",
        slug: "acme",
        profiled: "2026-04-10",
        sources: ["https://acme.com"],
      },
      "Acme Corp Profile"
    ),
  });
  t.after(cleanup);
  const result = runValidate(pmDir);
  assert.equal(
    result.ok,
    true,
    `competitor should not fail as evidence: ${JSON.stringify(result.details)}`
  );
  assert.ok(
    !result.details.some((d) => d.message.includes('expected "evidence"')),
    "should not complain about non-evidence type"
  );
});

test("PM-199: validate() is exported for programmatic use", () => {
  const { validate: validateFn } = require("../scripts/validate.js");
  assert.equal(typeof validateFn, "function", "validate must be exported as a function");
});

test("PM-199: validate() export returns errors/warnings/backlogCount", (t) => {
  const { validate: validateFn } = require("../scripts/validate.js");
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/test-item.md": makeBacklogItem(),
  });
  t.after(cleanup);
  const result = validateFn(pmDir);
  assert.ok(Array.isArray(result.errors), "errors must be an array");
  assert.ok(Array.isArray(result.warnings), "warnings must be an array");
  assert.equal(typeof result.backlogCount, "number", "backlogCount must be a number");
});

// ---------------------------------------------------------------------------
// PM-199 Issue 4: Schema validation test fixtures for all 8 KB types
// ---------------------------------------------------------------------------

const { validate: validateDirect } = require("../scripts/validate.js");
const FIXTURES_DIR = path.join(__dirname, "fixtures", "frontmatter");

function readFixture(name) {
  return fs.readFileSync(path.join(FIXTURES_DIR, name), "utf8");
}

// --- 1. Backlog fixtures ---

test("PM-199/fixtures: valid-backlog.md passes validation", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/fixture-item.md": readFixture("valid-backlog.md"),
  });
  t.after(cleanup);
  const result = validateDirect(pmDir);
  assert.equal(result.errors.length, 0, `expected no errors: ${JSON.stringify(result.errors)}`);
});

test("PM-199/fixtures: invalid-backlog.md reports errors for bad type, ID, priority, date, missing status", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/bad-fixture.md": readFixture("invalid-backlog.md"),
  });
  t.after(cleanup);
  const result = validateDirect(pmDir);
  assert.ok(result.errors.length > 0, "should have errors");
  // Missing status field
  assert.ok(
    result.errors.some((e) => e.field === "status"),
    "should report missing status"
  );
  // Invalid type "epic"
  assert.ok(
    result.errors.some((e) => e.field === "type" && e.msg.includes("epic")),
    "should report invalid type"
  );
  // Bad ID format
  assert.ok(
    result.errors.some((e) => e.field === "id" && e.msg.includes("bad-format")),
    "should report bad ID format"
  );
  // Invalid priority
  assert.ok(
    result.errors.some((e) => e.field === "priority" && e.msg.includes("urgent")),
    "should report invalid priority"
  );
  // Bad date
  assert.ok(
    result.errors.some((e) => e.field === "created" && e.msg.includes("YYYY-MM-DD")),
    "should report bad date format"
  );
});

// --- 2. Strategy fixtures ---

test("PM-199/fixtures: valid-strategy.md passes validation", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/strategy.md": readFixture("valid-strategy.md"),
  });
  t.after(cleanup);
  const result = validateDirect(pmDir);
  assert.equal(result.errors.length, 0, `expected no errors: ${JSON.stringify(result.errors)}`);
});

test("PM-199/fixtures: invalid-strategy.md reports wrong type, bad date, missing updated", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/strategy.md": readFixture("invalid-strategy.md"),
  });
  t.after(cleanup);
  const result = validateDirect(pmDir);
  assert.ok(result.errors.length > 0, "should have errors");
  // Wrong type
  assert.ok(
    result.errors.some((e) => e.field === "type" && e.msg.includes("plan")),
    "should report wrong type"
  );
  // Bad date
  assert.ok(
    result.errors.some((e) => e.field === "created" && e.msg.includes("YYYY-MM-DD")),
    "should report bad date"
  );
  // Missing updated
  assert.ok(
    result.errors.some((e) => e.field === "updated"),
    "should report missing updated"
  );
});

// --- 3. Insight fixtures ---

test("PM-199/fixtures: valid-insight.md passes validation", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/insights/product/fixture-validation.md": readFixture("valid-insight.md"),
    "pm/insights/product/index.md": makeIndex([
      "| [fixture-validation.md](fixture-validation.md) | Fixture validation | 2026-04-12 | active |",
    ]),
    "pm/insights/product/log.md": makeLog([
      "2026-04-12 create insights/product/fixture-validation.md",
    ]),
    "pm/evidence/research/fixture-source.md": makeEvidence({
      cited_by: ["insights/product/fixture-validation.md"],
    }),
    "pm/evidence/research/index.md": makeIndex([
      "| [fixture-source.md](fixture-source.md) | Fixture source | 2026-04-12 | active |",
    ]),
    "pm/evidence/research/log.md": makeLog([
      "2026-04-12 cite insights/product/fixture-validation.md -> evidence/research/fixture-source.md",
    ]),
  });
  t.after(cleanup);
  const result = validateDirect(pmDir);
  assert.equal(result.errors.length, 0, `expected no errors: ${JSON.stringify(result.errors)}`);
});

test("PM-199/fixtures: invalid-insight.md reports bad domain, date, enum, source target", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/insights/business/bad-insight.md": readFixture("invalid-insight.md"),
  });
  t.after(cleanup);
  const result = validateDirect(pmDir);
  assert.ok(result.errors.length > 0, "should have errors");
  // Bad domain format
  assert.ok(
    result.errors.some((e) => e.field === "domain"),
    "should report invalid domain"
  );
  // Bad date
  assert.ok(
    result.errors.some((e) => e.field === "last_updated" && e.msg.includes("YYYY-MM-DD")),
    "should report bad date"
  );
  // Invalid status enum
  assert.ok(
    result.errors.some((e) => e.field === "status" && e.msg.includes("archived")),
    "should report invalid status"
  );
  // Invalid confidence enum
  assert.ok(
    result.errors.some((e) => e.field === "confidence" && e.msg.includes("very-high")),
    "should report invalid confidence"
  );
  // Source pointing to non-evidence path
  assert.ok(
    result.errors.some((e) => e.field === "sources" && e.msg.includes("evidence")),
    "should report source not targeting evidence"
  );
});

// --- 4. Evidence fixtures ---

test("PM-199/fixtures: valid-evidence.md passes validation", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/evidence/research/fixture-evidence.md": readFixture("valid-evidence.md"),
    "pm/evidence/research/index.md": makeIndex([
      "| [fixture-evidence.md](fixture-evidence.md) | Fixture evidence | 2026-04-12 | active |",
    ]),
    "pm/evidence/research/log.md": makeLog([
      "2026-04-12 create evidence/research/fixture-evidence.md",
    ]),
    "pm/insights/product/fixture-validation.md": makeInsight({
      domain: "product",
      topic: "Fixture validation",
      sources: ["evidence/research/fixture-evidence.md"],
    }),
    "pm/insights/product/index.md": makeIndex([
      "| [fixture-validation.md](fixture-validation.md) | Fixture validation | 2026-04-12 | active |",
    ]),
    "pm/insights/product/log.md": makeLog([
      "2026-04-12 create insights/product/fixture-validation.md",
    ]),
  });
  t.after(cleanup);
  const result = validateDirect(pmDir);
  assert.equal(result.errors.length, 0, `expected no errors: ${JSON.stringify(result.errors)}`);
});

test("PM-199/fixtures: invalid-evidence.md reports bad source_origin, date, non-array sources, wrong cited_by target", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/evidence/research/bad-evidence.md": readFixture("invalid-evidence.md"),
  });
  t.after(cleanup);
  const result = validateDirect(pmDir);
  assert.ok(result.errors.length > 0, "should have errors");
  // Bad source_origin
  assert.ok(
    result.errors.some((e) => e.field === "source_origin" && e.msg.includes("alien")),
    "should report invalid source_origin"
  );
  // Bad date
  assert.ok(
    result.errors.some((e) => e.field === "created" && e.msg.includes("YYYY-MM-DD")),
    "should report bad date"
  );
  // Sources not an array
  assert.ok(
    result.errors.some((e) => e.field === "sources" && e.msg.includes("array")),
    "should report sources not being an array"
  );
  // cited_by pointing to non-insight path
  assert.ok(
    result.errors.some((e) => e.field === "cited_by" && e.msg.includes("insight")),
    "should report cited_by not targeting insights"
  );
});

// --- 5. Competitor fixtures ---

test("PM-199/fixtures: valid-competitor.md passes validation", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/evidence/competitors/fixture-corp/profile.md": readFixture("valid-competitor.md"),
  });
  t.after(cleanup);
  const result = validateDirect(pmDir);
  assert.equal(result.errors.length, 0, `expected no errors: ${JSON.stringify(result.errors)}`);
});

test("PM-199/fixtures: invalid-competitor.md reports bad type, slug mismatch, bad date", (t) => {
  // Place in acme/ dir so slug "wrong-slug" mismatches parent dir "acme"
  const { pmDir, cleanup } = withPmDir({
    "pm/evidence/competitors/acme/bad.md": readFixture("invalid-competitor.md"),
  });
  t.after(cleanup);
  const result = validateDirect(pmDir);
  assert.ok(result.errors.length > 0, "should have errors");
  // Invalid competitor type
  assert.ok(
    result.errors.some((e) => e.field === "type" && e.msg.includes("competitor-unknown")),
    "should report invalid competitor type"
  );
  // Slug mismatch
  assert.ok(
    result.errors.some((e) => e.field === "slug" && e.msg.includes("does not match")),
    "should report slug mismatch"
  );
  // Bad date
  assert.ok(
    result.errors.some((e) => e.field === "profiled" && e.msg.includes("YYYY-MM-DD")),
    "should report bad profiled date"
  );
});

// --- 6. Notes fixtures ---

test("PM-199/fixtures: valid-notes.md passes validation", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/evidence/notes/2026-04.md": readFixture("valid-notes.md"),
  });
  t.after(cleanup);
  const result = validateDirect(pmDir);
  assert.equal(result.errors.length, 0, `expected no errors: ${JSON.stringify(result.errors)}`);
});

test("PM-199/fixtures: invalid-notes.md reports bad month, date, note_count, digested_through", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/evidence/notes/bad.md": readFixture("invalid-notes.md"),
  });
  t.after(cleanup);
  const result = validateDirect(pmDir);
  assert.ok(result.errors.length > 0, "should have errors");
  // Bad month format
  assert.ok(
    result.errors.some((e) => e.field === "month" && e.msg.includes("YYYY-MM")),
    "should report bad month format"
  );
  // Bad date
  assert.ok(
    result.errors.some((e) => e.field === "updated" && e.msg.includes("YYYY-MM-DD")),
    "should report bad date format"
  );
  // Negative note_count
  assert.ok(
    result.errors.some((e) => e.field === "note_count"),
    "should report invalid note_count"
  );
  // Bad digested_through
  assert.ok(
    result.errors.some((e) => e.field === "digested_through"),
    "should report bad digested_through"
  );
});

// --- 7. Memory fixtures ---

test("PM-199/fixtures: valid-memory.md passes validation", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/memory.md": readFixture("valid-memory.md"),
  });
  t.after(cleanup);
  const result = validateDirect(pmDir);
  assert.equal(result.errors.length, 0, `expected no errors: ${JSON.stringify(result.errors)}`);
});

test("PM-199/fixtures: invalid-memory.md reports wrong type, bad entry date, bad category, bad pinned", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/memory.md": readFixture("invalid-memory.md"),
  });
  t.after(cleanup);
  const result = validateDirect(pmDir);
  assert.ok(result.errors.length > 0, "should have errors");
  // Wrong type
  assert.ok(
    result.errors.some((e) => e.field === "type" && e.msg.includes("project-memory")),
    "should report wrong type"
  );
  // Bad date in entry
  assert.ok(
    result.errors.some((e) => e.msg.includes("YYYY-MM-DD")),
    "should report bad entry date"
  );
  // Invalid category
  assert.ok(
    result.errors.some((e) => e.msg.includes("invalid-category")),
    "should report invalid category"
  );
  // Bad pinned
  assert.ok(
    result.errors.some((e) => e.msg.includes("pinned")),
    "should report invalid pinned value"
  );
});

// --- 8. Features fixtures ---

test("PM-199/fixtures: valid-features.md passes validation", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/product/features.md": readFixture("valid-features.md"),
  });
  t.after(cleanup);
  const result = validateDirect(pmDir);
  assert.equal(result.errors.length, 0, `expected no errors: ${JSON.stringify(result.errors)}`);
});

test("PM-199/fixtures: invalid-features.md reports missing generated, count mismatch, empty areas", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/product/features.md": readFixture("invalid-features.md"),
  });
  t.after(cleanup);
  const result = validateDirect(pmDir);
  assert.ok(result.errors.length > 0, "should have errors");
  // Missing generated
  assert.ok(
    result.errors.some((e) => e.field === "generated"),
    "should report missing generated"
  );
  // feature_count mismatch
  assert.ok(
    result.errors.some((e) => e.field === "feature_count"),
    "should report feature_count mismatch"
  );
  // Empty areas
  assert.ok(
    result.errors.some((e) => e.field === "areas"),
    "should report empty areas"
  );
});

// --- Deprecation fixtures ---

test("PM-199/fixtures: deprecated backlog-issue type produces warning, not error", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/deprecated-item.md": readFixture("deprecated-backlog-issue.md"),
  });
  t.after(cleanup);
  const result = validateDirect(pmDir);
  assert.equal(result.errors.length, 0, "deprecated type should not produce errors");
  assert.ok(
    result.warnings.some((w) => w.field === "type" && w.msg.includes("deprecated")),
    "should produce deprecation warning for backlog-issue"
  );
});

test("PM-199/fixtures: deprecated proposal type produces warning, not error", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/deprecated-proposal.md": readFixture("deprecated-proposal.md"),
  });
  t.after(cleanup);
  const result = validateDirect(pmDir);
  assert.equal(result.errors.length, 0, "deprecated type should not produce errors");
  assert.ok(
    result.warnings.some((w) => w.field === "type" && w.msg.includes("deprecated")),
    "should produce deprecation warning for proposal"
  );
});

test("PM-199/fixtures: deprecated idea type produces warning, not error", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/deprecated-idea.md": readFixture("deprecated-idea.md"),
  });
  t.after(cleanup);
  const result = validateDirect(pmDir);
  assert.equal(result.errors.length, 0, "deprecated type should not produce errors");
  assert.ok(
    result.warnings.some((w) => w.field === "type" && w.msg.includes("deprecated")),
    "should produce deprecation warning for idea"
  );
});

test("PM-199/fixtures: deprecated landscape type produces warning, not error", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/insights/business/landscape-topic.md": readFixture("deprecated-landscape.md"),
    "pm/insights/business/index.md": makeIndex([
      "| [landscape-topic.md](landscape-topic.md) | Market landscape | 2026-04-12 | active |",
    ]),
    "pm/insights/business/log.md": makeLog([
      "2026-04-12 create insights/business/landscape-topic.md",
    ]),
    "pm/evidence/research/market-data.md": makeEvidence({
      cited_by: ["insights/business/landscape-topic.md"],
    }),
    "pm/evidence/research/index.md": makeIndex([
      "| [market-data.md](market-data.md) | Market data | 2026-04-12 | active |",
    ]),
    "pm/evidence/research/log.md": makeLog([
      "2026-04-12 cite insights/business/landscape-topic.md -> evidence/research/market-data.md",
    ]),
  });
  t.after(cleanup);
  const result = validateDirect(pmDir);
  assert.equal(
    result.errors.length,
    0,
    `landscape should not produce errors: ${JSON.stringify(result.errors)}`
  );
  assert.ok(
    result.warnings.some((w) => w.field === "type" && w.msg.includes("landscape")),
    "should produce deprecation warning for landscape"
  );
});

// ---------------------------------------------------------------------------
// PM-199 Issue 5: Forbidden-syntax guard
// ---------------------------------------------------------------------------

test("PM-199: forbidden-syntax guard rejects backlog status with parenthetical content", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/bad-syntax.md": makeBacklogItem({ status: '"idea (needs review)"' }),
  });
  t.after(cleanup);
  const result = runValidate(pmDir);
  assert.equal(result.ok, false);
  assert.ok(
    result.details.some((d) => d.field === "status" && d.message.includes("forbidden syntax")),
    "should reject status with parenthetical content"
  );
});

test("PM-199: forbidden-syntax guard rejects backlog priority with parenthetical content", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/bad-prio-syntax.md": makeBacklogItem({ priority: '"high (needs review)"' }),
  });
  t.after(cleanup);
  const result = runValidate(pmDir);
  assert.equal(result.ok, false);
  assert.ok(
    result.details.some((d) => d.field === "priority" && d.message.includes("forbidden syntax")),
    "should reject priority with parenthetical content"
  );
});

test("PM-199: forbidden-syntax guard rejects insight status with parenthetical content", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/insights/business/bad-insight.md": makeInsight({ status: '"active (under review)"' }),
  });
  t.after(cleanup);
  const result = runValidate(pmDir);
  assert.equal(result.ok, false);
  assert.ok(
    result.details.some((d) => d.field === "status" && d.message.includes("forbidden syntax")),
    "should reject insight status with parenthetical content"
  );
});

test("PM-199: forbidden-syntax guard rejects insight confidence with parenthetical content", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/insights/business/bad-conf.md": makeInsight({ confidence: '"high (tentative)"' }),
  });
  t.after(cleanup);
  const result = runValidate(pmDir);
  assert.equal(result.ok, false);
  assert.ok(
    result.details.some((d) => d.field === "confidence" && d.message.includes("forbidden syntax")),
    "should reject confidence with parenthetical content"
  );
});

test("PM-199: forbidden-syntax guard rejects evidence source_origin with parenthetical content", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/evidence/research/bad-origin.md": makeEvidence({
      source_origin: '"external (mostly)"',
      cited_by: [],
    }),
    "pm/evidence/research/index.md": makeIndex([
      "| [bad-origin.md](bad-origin.md) | Bad origin | 2026-04-12 | active |",
    ]),
    "pm/evidence/research/log.md": makeLog(["2026-04-12 create evidence/research/bad-origin.md"]),
  });
  t.after(cleanup);
  const result = runValidate(pmDir);
  assert.equal(result.ok, false);
  assert.ok(
    result.details.some(
      (d) => d.field === "source_origin" && d.message.includes("forbidden syntax")
    ),
    "should reject source_origin with parenthetical content"
  );
});

test("PM-199: clean enum values still pass validation", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/clean-enums.md": makeBacklogItem({
      status: "in-progress",
      priority: "high",
      evidence_strength: "strong",
      scope_signal: "medium",
      competitor_gap: "partial",
    }),
  });
  t.after(cleanup);
  const result = runValidate(pmDir);
  assert.equal(result.ok, true, `clean enums should pass: ${JSON.stringify(result.details)}`);
});

// ---------------------------------------------------------------------------
// PM-199 Issue 5: Schema-validator drift detection
// ---------------------------------------------------------------------------

const {
  VALID_STATUSES: V_STATUSES,
  VALID_PRIORITIES: V_PRIORITIES,
  VALID_EVIDENCE: V_EVIDENCE,
  VALID_SCOPE: V_SCOPE,
  VALID_GAP: V_GAP,
  VALID_INSIGHT_STATUSES: V_INSIGHT_STATUSES,
  VALID_CONFIDENCE: V_CONFIDENCE,
  VALID_SOURCE_ORIGINS: V_SOURCE_ORIGINS,
  VALID_COMPETITOR_TYPES: V_COMPETITOR_TYPES,
  REQUIRED_BACKLOG_FIELDS: R_BACKLOG,
  REQUIRED_STRATEGY_FIELDS: R_STRATEGY,
  REQUIRED_INSIGHT_FIELDS: R_INSIGHT,
  REQUIRED_EVIDENCE_FIELDS: R_EVIDENCE,
  REQUIRED_NOTES_FIELDS: R_NOTES,
  REQUIRED_COMPETITOR_FIELDS: R_COMPETITOR,
} = require("../scripts/validate.js");

const REFERENCE_PATH = path.join(__dirname, "..", "references", "frontmatter-schemas.md");

test("PM-199: drift — reference file exists", () => {
  assert.ok(fs.existsSync(REFERENCE_PATH), "references/frontmatter-schemas.md must exist");
});

test("PM-199: drift — every enum constant in validate.js appears backtick-wrapped in reference file", () => {
  const refContent = fs.readFileSync(REFERENCE_PATH, "utf8");

  // Only check enums documented in the reference file's schema tables.
  // VALID_MEMORY_CATEGORIES is validated but not in the reference (memory
  // documents are not part of the 8 documented KB schema types).
  const enumSets = {
    VALID_STATUSES: V_STATUSES,
    VALID_PRIORITIES: V_PRIORITIES,
    VALID_EVIDENCE: V_EVIDENCE,
    VALID_SCOPE: V_SCOPE,
    VALID_GAP: V_GAP,
    VALID_INSIGHT_STATUSES: V_INSIGHT_STATUSES,
    VALID_CONFIDENCE: V_CONFIDENCE,
    VALID_SOURCE_ORIGINS: V_SOURCE_ORIGINS,
    VALID_COMPETITOR_TYPES: V_COMPETITOR_TYPES,
  };

  const missing = [];
  for (const [setName, values] of Object.entries(enumSets)) {
    for (const val of values) {
      // Must appear backtick-wrapped: `"value"` or `value`
      const escaped = val.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const backtickPattern = new RegExp("`[^`]*" + escaped + "[^`]*`");
      if (!backtickPattern.test(refContent)) {
        missing.push(`${setName}: "${val}" not found backtick-wrapped in reference`);
      }
    }
  }

  assert.equal(
    missing.length,
    0,
    `Drift detected — validator constants missing from reference:\n  ${missing.join("\n  ")}`
  );
});

test("PM-199: drift — every backtick-wrapped enum value in reference schema tables appears in validator constants", () => {
  const refContent = fs.readFileSync(REFERENCE_PATH, "utf8");

  // Collect all validator enum values into a single set for reverse lookup.
  // Excludes VALID_MEMORY_CATEGORIES (not documented in reference schema tables).
  const allEnumValues = new Set([
    ...V_STATUSES,
    ...V_PRIORITIES,
    ...V_EVIDENCE,
    ...V_SCOPE,
    ...V_GAP,
    ...V_INSIGHT_STATUSES,
    ...V_CONFIDENCE,
    ...V_SOURCE_ORIGINS,
    ...V_COMPETITOR_TYPES,
    // Fixed type values (not enums but referenced in schema tables)
    "backlog",
    "strategy",
    "evidence",
    "insight",
    "notes",
    "competitor-profile",
    "competitor-features",
    "competitor-sentiment",
    "competitor-api",
    "competitor-seo",
    "research",
    "transcript",
    "user-feedback",
  ]);

  // Extract enum values from "Valid Values" columns in schema tables.
  // Schema tables have rows like: | `field` | type | req | `"value"` \| `"value"` | desc |
  // We extract backtick-wrapped quoted strings from the Valid Values column (column 4).
  const tableRowPattern = /^\|[^|]+\|[^|]+\|[^|]+\|([^|]+)\|/gm;
  const backtickValuePattern = /`"([^"]+)"`/g;

  const refValues = new Set();
  let rowMatch;
  while ((rowMatch = tableRowPattern.exec(refContent)) !== null) {
    const validValuesCell = rowMatch[1];
    let valMatch;
    while ((valMatch = backtickValuePattern.exec(validValuesCell)) !== null) {
      refValues.add(valMatch[1]);
    }
  }

  // Filter out non-enum cell content (format patterns, descriptions)
  const formatPatterns = /^(TEAM-NNN|YYYY-MM|YYYY-MM-DD|PM-199|XS|S|M|L|XL)$/;

  const notInValidator = [];
  for (const val of refValues) {
    if (formatPatterns.test(val)) continue;
    if (!allEnumValues.has(val)) {
      notInValidator.push(`"${val}" in reference but not in validator constants`);
    }
  }

  assert.equal(
    notInValidator.length,
    0,
    `Drift detected — reference values missing from validator:\n  ${notInValidator.join("\n  ")}`
  );
});

test("PM-199: drift — every required-field array in validate.js has a matching schema table in reference", () => {
  const refContent = fs.readFileSync(REFERENCE_PATH, "utf8");

  const requiredFieldSets = {
    REQUIRED_BACKLOG_FIELDS: R_BACKLOG,
    REQUIRED_STRATEGY_FIELDS: R_STRATEGY,
    REQUIRED_INSIGHT_FIELDS: R_INSIGHT,
    REQUIRED_EVIDENCE_FIELDS: R_EVIDENCE,
    REQUIRED_NOTES_FIELDS: R_NOTES,
    REQUIRED_COMPETITOR_FIELDS: R_COMPETITOR,
  };

  const missing = [];
  for (const [setName, fields] of Object.entries(requiredFieldSets)) {
    for (const field of fields) {
      // Each required field should appear as a backtick-wrapped field name in a table row
      const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const fieldPattern = new RegExp("\\|\\s*`" + escaped + "`\\s*\\|");
      if (!fieldPattern.test(refContent)) {
        missing.push(
          `${setName}: field "${field}" not found as backtick-wrapped row in reference table`
        );
      }
    }
  }

  assert.equal(
    missing.length,
    0,
    `Drift detected — required fields missing from reference:\n  ${missing.join("\n  ")}`
  );
});

// ---------------------------------------------------------------------------
// PM-201 Issue 1: Config sync preferences validation
// ---------------------------------------------------------------------------

const { validateConfig } = require(VALIDATE_SCRIPT);

test("PM-201: config with sync block validates successfully", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "config-test-"));
  const configPath = path.join(root, "config.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      config_schema: 2,
      projectId: "proj-1",
      sync: { enabled: true, auto_pull: true, auto_push: false },
    })
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const result = validateConfig(configPath);
  assert.equal(result.errors.length, 0, `should pass: ${JSON.stringify(result.errors)}`);
});

test("PM-201: config without sync block validates successfully (defaults apply)", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "config-test-"));
  const configPath = path.join(root, "config.json");
  fs.writeFileSync(configPath, JSON.stringify({ config_schema: 2, projectId: "proj-1" }));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const result = validateConfig(configPath);
  assert.equal(
    result.errors.length,
    0,
    `should pass without sync block: ${JSON.stringify(result.errors)}`
  );
});

test("PM-201: config with sync.enabled as non-boolean reports error", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "config-test-"));
  const configPath = path.join(root, "config.json");
  fs.writeFileSync(configPath, JSON.stringify({ config_schema: 2, sync: { enabled: "yes" } }));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const result = validateConfig(configPath);
  assert.ok(result.errors.length > 0, "should report error for non-boolean enabled");
  assert.ok(
    result.errors.some((e) => e.field === "sync.enabled"),
    "error should reference sync.enabled"
  );
});

test("PM-201: config with sync.auto_pull as non-boolean reports error", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "config-test-"));
  const configPath = path.join(root, "config.json");
  fs.writeFileSync(configPath, JSON.stringify({ config_schema: 2, sync: { auto_pull: 1 } }));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const result = validateConfig(configPath);
  assert.ok(result.errors.length > 0, "should report error for non-boolean auto_pull");
  assert.ok(
    result.errors.some((e) => e.field === "sync.auto_pull"),
    "error should reference sync.auto_pull"
  );
});

test("PM-201: config with sync.auto_push as non-boolean reports error", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "config-test-"));
  const configPath = path.join(root, "config.json");
  fs.writeFileSync(configPath, JSON.stringify({ config_schema: 2, sync: { auto_push: "false" } }));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const result = validateConfig(configPath);
  assert.ok(result.errors.length > 0, "should report error for non-boolean auto_push");
  assert.ok(
    result.errors.some((e) => e.field === "sync.auto_push"),
    "error should reference sync.auto_push"
  );
});

test("PM-201: config with sync as non-object reports error", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "config-test-"));
  const configPath = path.join(root, "config.json");
  fs.writeFileSync(configPath, JSON.stringify({ config_schema: 2, sync: "on" }));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const result = validateConfig(configPath);
  assert.ok(result.errors.length > 0, "should report error for non-object sync");
  assert.ok(
    result.errors.some((e) => e.field === "sync"),
    "error should reference sync"
  );
});

test("PM-201: config with all sync booleans false validates successfully", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "config-test-"));
  const configPath = path.join(root, "config.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      config_schema: 2,
      sync: { enabled: false, auto_pull: false, auto_push: false },
    })
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const result = validateConfig(configPath);
  assert.equal(
    result.errors.length,
    0,
    `all-false sync should pass: ${JSON.stringify(result.errors)}`
  );
});
