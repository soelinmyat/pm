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

test("PM-155: item without type passes validation", () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/no-type-item.md": makeBacklogItem({}),
  });
  try {
    const result = runValidate(pmDir);
    assert.equal(
      result.ok,
      true,
      `item without type should pass: ${JSON.stringify(result.details)}`
    );
  } finally {
    cleanup();
  }
});

test("PM-155: item with type still passes validation (backwards compat)", () => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/typed-item.md": makeBacklogItem({ type: "backlog-issue" }),
  });
  try {
    const result = runValidate(pmDir);
    assert.equal(
      result.ok,
      true,
      `item with type should still pass: ${JSON.stringify(result.details)}`
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

// ---------------------------------------------------------------------------
// PM-160: Thinking artifact validation
// ---------------------------------------------------------------------------

function makeThinking(overrides = {}) {
  return makeFrontmatterDocument(
    {
      type: "thinking",
      topic: "Test idea",
      slug: "test-idea",
      created: "2026-04-10",
      status: "active",
      promoted_to: "null",
      ...overrides,
    },
    "Test idea"
  );
}

test("PM-160: valid thinking artifact passes validation", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/thinking/test-idea.md": makeThinking(),
  });
  t.after(cleanup);
  const result = runValidate(pmDir);
  assert.equal(result.ok, true, `should pass: ${JSON.stringify(result.details)}`);
});

test("PM-160: thinking artifact missing required fields reports errors", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/thinking/bad.md": makeFrontmatterDocument({ type: "thinking" }, "Bad"),
  });
  t.after(cleanup);
  const result = runValidate(pmDir);
  assert.equal(result.ok, false);
  assert.ok(
    result.details.some((d) => d.field === "topic"),
    "should report missing topic"
  );
  assert.ok(
    result.details.some((d) => d.field === "slug"),
    "should report missing slug"
  );
  assert.ok(
    result.details.some((d) => d.field === "created"),
    "should report missing created"
  );
  assert.ok(
    result.details.some((d) => d.field === "status"),
    "should report missing status"
  );
});

test("PM-160: thinking artifact with invalid status reports error", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/thinking/bad-status.md": makeThinking({ status: "completed" }),
  });
  t.after(cleanup);
  const result = runValidate(pmDir);
  assert.equal(result.ok, false);
  assert.ok(result.details.some((d) => d.field === "status" && d.message.includes("completed")));
});

test("PM-160: thinking artifact with wrong type reports error", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/thinking/wrong-type.md": makeThinking({ type: "idea" }),
  });
  t.after(cleanup);
  const result = runValidate(pmDir);
  assert.equal(result.ok, false);
  assert.ok(result.details.some((d) => d.field === "type"));
});

test("PM-160: promoted thinking artifact passes validation", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/thinking/promoted.md": makeThinking({
      status: "promoted",
      promoted_to: "PM-042",
    }),
  });
  t.after(cleanup);
  const result = runValidate(pmDir);
  assert.equal(result.ok, true, `should pass: ${JSON.stringify(result.details)}`);
});

test("PM-160: parked thinking artifact passes validation", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/thinking/parked.md": makeThinking({ status: "parked" }),
  });
  t.after(cleanup);
  const result = runValidate(pmDir);
  assert.equal(result.ok, true, `should pass: ${JSON.stringify(result.details)}`);
});

// ---------------------------------------------------------------------------
// PM-160: Single-file validation (validate-file.js)
// ---------------------------------------------------------------------------

const VALIDATE_FILE_SCRIPT = path.join(__dirname, "..", "scripts", "validate-file.js");

function runValidateFile(filePath, pmDir) {
  const args = [VALIDATE_FILE_SCRIPT, "--file", filePath];
  if (pmDir) args.push("--pm-dir", pmDir);
  try {
    const stdout = execFileSync("node", args, { encoding: "utf8" });
    return JSON.parse(stdout);
  } catch (err) {
    return JSON.parse(err.stdout);
  }
}

test("PM-160: validate-file passes for valid backlog item", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/good.md": makeBacklogItem(),
  });
  t.after(cleanup);
  const result = runValidateFile(path.join(pmDir, "backlog", "good.md"), pmDir);
  assert.equal(result.ok, true);
});

test("PM-160: validate-file fails for backlog item missing fields", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/backlog/bad.md": "---\ntitle: Missing fields\n---\n\n# Bad\n",
  });
  t.after(cleanup);
  const result = runValidateFile(path.join(pmDir, "backlog", "bad.md"), pmDir);
  assert.equal(result.ok, false);
  assert.ok(result.errors.length > 0);
});

test("PM-160: validate-file passes for valid thinking artifact", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/thinking/good.md": makeThinking(),
  });
  t.after(cleanup);
  const result = runValidateFile(path.join(pmDir, "thinking", "good.md"), pmDir);
  assert.equal(result.ok, true);
});

test("PM-160: validate-file fails for thinking artifact missing fields", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/thinking/bad.md": "---\ntype: thinking\n---\n\n# Bad\n",
  });
  t.after(cleanup);
  const result = runValidateFile(path.join(pmDir, "thinking", "bad.md"), pmDir);
  assert.equal(result.ok, false);
  assert.ok(result.errors.length > 0);
});

test("PM-160: validate-file skips non-pm files", (t) => {
  const tmpFile = path.join(os.tmpdir(), "not-pm-file.md");
  fs.writeFileSync(tmpFile, "# Not in pm\n");
  try {
    const result = runValidateFile(tmpFile);
    assert.equal(result.ok, true, "non-pm files should pass (skip)");
    assert.equal(result.skipped, true);
  } finally {
    fs.unlinkSync(tmpFile);
  }
});

test("PM-160: validate-file passes for valid evidence file", (t) => {
  const { pmDir, cleanup } = withPmDir({
    "pm/evidence/research/topic.md": makeEvidence({ cited_by: [] }),
  });
  t.after(cleanup);
  const result = runValidateFile(path.join(pmDir, "evidence", "research", "topic.md"), pmDir);
  assert.equal(result.ok, true, `should pass: ${JSON.stringify(result.errors)}`);
});

// ---------------------------------------------------------------------------

test("real pm/ directory passes validation", (t) => {
  const realPmDir = path.join(__dirname, "..", "pm");
  if (!fs.existsSync(realPmDir)) {
    t.skip("no pm/ directory in repo");
    return;
  }
  const result = runValidate(realPmDir);
  assert.equal(result.ok, true, `validation failed: ${JSON.stringify(result.details)}`);
});
