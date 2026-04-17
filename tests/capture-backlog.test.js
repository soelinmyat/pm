"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

const { captureBacklogItem, nextBacklogId, slugify } = require("../scripts/capture-backlog.js");
const { parseFrontmatter } = require("../scripts/kb-frontmatter.js");

function makeTmpPm() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "capture-backlog-"));
  const pmDir = path.join(root, "pm");
  fs.mkdirSync(path.join(pmDir, "backlog"), { recursive: true });
  return {
    pmDir,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

test("PM-51 capture: slugify handles punctuation and spaces", () => {
  assert.equal(slugify("Bump ESLint to v10"), "bump-eslint-to-v10");
  assert.equal(slugify("  Fix: header —  broken link"), "fix-header-broken-link");
  assert.equal(slugify("CSV export error"), "csv-export-error");
});

test("PM-51 capture: nextBacklogId starts at PM-001 when backlog empty", (t) => {
  const { pmDir, cleanup } = makeTmpPm();
  t.after(cleanup);
  assert.equal(nextBacklogId(pmDir), "PM-001");
});

test("PM-51 capture: nextBacklogId skips past existing max", (t) => {
  const { pmDir, cleanup } = makeTmpPm();
  t.after(cleanup);
  fs.writeFileSync(path.join(pmDir, "backlog", "a.md"), "---\ntype: backlog\nid: PM-003\n---\n");
  fs.writeFileSync(path.join(pmDir, "backlog", "b.md"), "---\ntype: backlog\nid: PM-007\n---\n");
  assert.equal(nextBacklogId(pmDir), "PM-008");
});

test("PM-51 capture: writes task item with kind=task and defaults", (t) => {
  const { pmDir, cleanup } = makeTmpPm();
  t.after(cleanup);
  const result = captureBacklogItem(pmDir, {
    kind: "task",
    title: "Bump ESLint to v10",
    outcome: "ESLint is on v10",
  });
  assert.equal(result.slug, "bump-eslint-to-v10");
  assert.equal(result.id, "PM-001");
  const content = fs.readFileSync(result.filePath, "utf8");
  const parsed = parseFrontmatter(content);
  assert.equal(parsed.data.kind, "task");
  assert.equal(parsed.data.status, "proposed");
  assert.equal(parsed.data.priority, "medium");
  assert.deepEqual(parsed.data.labels, ["chore"]);
  assert.equal(parsed.data.title, "Bump ESLint to v10");
});

test("PM-51 capture: writes bug item with priority=high override", (t) => {
  const { pmDir, cleanup } = makeTmpPm();
  t.after(cleanup);
  const result = captureBacklogItem(pmDir, {
    kind: "bug",
    title: "CSV export fails on UTF-8",
    priority: "high",
    labels: ["bug"],
    body: "## Observed\n\nExport truncates Unicode.\n",
  });
  const parsed = parseFrontmatter(fs.readFileSync(result.filePath, "utf8"));
  assert.equal(parsed.data.kind, "bug");
  assert.equal(parsed.data.priority, "high");
  assert.deepEqual(parsed.data.labels, ["bug"]);
  assert.match(parsed.body, /## Observed/);
});

test("PM-51 capture: refuses to overwrite existing file", (t) => {
  const { pmDir, cleanup } = makeTmpPm();
  t.after(cleanup);
  captureBacklogItem(pmDir, { kind: "task", title: "Dup" });
  assert.throws(
    () => captureBacklogItem(pmDir, { kind: "task", title: "Dup" }),
    /refusing to overwrite/
  );
});

test("PM-51 capture: captured file passes validator", (t) => {
  const { pmDir, cleanup } = makeTmpPm();
  t.after(cleanup);
  captureBacklogItem(pmDir, {
    kind: "task",
    title: "Version bump test",
    outcome: "bumped",
  });
  const { execFileSync } = require("child_process");
  const out = execFileSync(
    "node",
    [path.join(__dirname, "..", "scripts", "validate.js"), "--dir", pmDir],
    { encoding: "utf8" }
  );
  const result = JSON.parse(out);
  assert.equal(result.ok, true, JSON.stringify(result.details));
});
