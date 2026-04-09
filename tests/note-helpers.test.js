"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

const { writeNote, parseNotesFile } = require("../scripts/note-helpers.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withTempPmDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "note-test-"));
  const pmDir = path.join(root, "pm");
  return {
    pmDir,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

// ---------------------------------------------------------------------------
// writeNote tests
// ---------------------------------------------------------------------------

test("writeNote creates directory and file when notes/ does not exist", (t) => {
  const { pmDir, cleanup } = withTempPmDir();
  t.after(cleanup);

  const result = writeNote(
    pmDir,
    "Lost deal to CompetitorX",
    "sales call",
    "competitor, integration"
  );

  // File must exist
  const notesDir = path.join(pmDir, "evidence", "notes");
  assert.ok(fs.existsSync(notesDir), "notes directory must be created");

  const files = fs.readdirSync(notesDir).filter((f) => f.endsWith(".md"));
  assert.equal(files.length, 1, "exactly one monthly file must exist");

  const content = fs.readFileSync(path.join(notesDir, files[0]), "utf8");
  assert.ok(content.startsWith("---\n"), "must start with frontmatter");
  assert.ok(content.includes("type: notes"), "frontmatter must include type: notes");
  assert.ok(content.includes("note_count: 1"), "note_count must be 1");
  assert.ok(content.includes("digested_through: null"), "digested_through must be null");
  assert.ok(content.includes("Lost deal to CompetitorX"), "must contain note text");
  assert.ok(content.includes("sales call"), "heading must contain source type");
  assert.ok(content.includes("Tags: competitor, integration"), "must contain tags");

  // Result must include the file path
  assert.ok(result.filePath, "must return filePath");
  assert.ok(result.timestamp, "must return timestamp");
});

test("writeNote appends second note to same month, increments note_count", (t) => {
  const { pmDir, cleanup } = withTempPmDir();
  t.after(cleanup);

  writeNote(pmDir, "First note", "observation", "");
  writeNote(pmDir, "Second note", "support thread", "performance");

  const notesDir = path.join(pmDir, "evidence", "notes");
  const files = fs.readdirSync(notesDir).filter((f) => f.endsWith(".md"));
  assert.equal(files.length, 1, "still one monthly file");

  const content = fs.readFileSync(path.join(notesDir, files[0]), "utf8");
  assert.ok(content.includes("note_count: 2"), "note_count must be 2");
  assert.ok(content.includes("First note"), "first note must be present");
  assert.ok(content.includes("Second note"), "second note must be present");
});

test("writeNote uses default source 'observation' when not specified", (t) => {
  const { pmDir, cleanup } = withTempPmDir();
  t.after(cleanup);

  writeNote(pmDir, "Something happened", "", "");

  const notesDir = path.join(pmDir, "evidence", "notes");
  const files = fs.readdirSync(notesDir).filter((f) => f.endsWith(".md"));
  const content = fs.readFileSync(path.join(notesDir, files[0]), "utf8");
  assert.ok(content.includes("observation"), "heading must default to observation");
});

test("writeNote preserves existing digested_through when appending", (t) => {
  const { pmDir, cleanup } = withTempPmDir();
  t.after(cleanup);

  // Pre-create a notes file with a non-null digested_through
  const notesDir = path.join(pmDir, "evidence", "notes");
  fs.mkdirSync(notesDir, { recursive: true });
  const now = new Date();
  const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const filePath = path.join(notesDir, `${monthStr}.md`);
  fs.writeFileSync(
    filePath,
    `---
type: notes
month: ${monthStr}
updated: 2026-04-01
note_count: 1
digested_through: 2026-04-01 10:00
---

### 2026-04-01 10:00 — observation
Old note here.
Tags: test
`
  );

  writeNote(pmDir, "New note", "observation", "");

  const content = fs.readFileSync(filePath, "utf8");
  assert.ok(
    content.includes("digested_through: 2026-04-01 10:00"),
    "must preserve existing digested_through"
  );
  assert.ok(content.includes("note_count: 2"), "note_count must increment");
  assert.ok(content.includes("New note"), "new note must be appended");
  assert.ok(content.includes("Old note here"), "old note must be preserved");
});

test("writeNote source type appears in heading", (t) => {
  const { pmDir, cleanup } = withTempPmDir();
  t.after(cleanup);

  writeNote(pmDir, "Customer feedback", "user interview", "");

  const notesDir = path.join(pmDir, "evidence", "notes");
  const files = fs.readdirSync(notesDir).filter((f) => f.endsWith(".md"));
  const content = fs.readFileSync(path.join(notesDir, files[0]), "utf8");
  // The heading should be like ### 2026-04-09 14:32 — user interview
  assert.ok(
    /###\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+—\s+user interview/.test(content),
    "heading must contain source type 'user interview'"
  );
});

// ---------------------------------------------------------------------------
// parseNotesFile tests
// ---------------------------------------------------------------------------

test("parseNotesFile parses frontmatter and entries from a well-formed file", (t) => {
  const { pmDir, cleanup } = withTempPmDir();
  t.after(cleanup);

  const notesDir = path.join(pmDir, "evidence", "notes");
  fs.mkdirSync(notesDir, { recursive: true });
  const filePath = path.join(notesDir, "2026-04.md");
  fs.writeFileSync(
    filePath,
    `---
type: notes
month: 2026-04
updated: 2026-04-09
note_count: 2
digested_through: null
---

### 2026-04-09 14:32 — sales call
Lost deal to CompetitorX — they had native Slack integration.
Tags: competitor, integration

### 2026-04-09 16:10 — support thread
Third user this week hitting timeout on large CSV imports.
Tags: performance, import
`
  );

  const result = parseNotesFile(filePath);
  assert.equal(result.frontmatter.type, "notes");
  assert.equal(result.frontmatter.month, "2026-04");
  assert.equal(result.frontmatter.note_count, "2");
  assert.equal(result.frontmatter.digested_through, "null");
  assert.equal(result.entries.length, 2);
  assert.ok(result.entries[0].timestamp, "entry must have timestamp");
  assert.ok(result.entries[0].source, "entry must have source");
  assert.ok(result.entries[0].body.includes("Lost deal"), "first entry must have body");
  assert.ok(result.entries[1].body.includes("Third user"), "second entry must have body");
});

test("parseNotesFile returns empty entries for file with frontmatter only", (t) => {
  const { pmDir, cleanup } = withTempPmDir();
  t.after(cleanup);

  const notesDir = path.join(pmDir, "evidence", "notes");
  fs.mkdirSync(notesDir, { recursive: true });
  const filePath = path.join(notesDir, "2026-04.md");
  fs.writeFileSync(
    filePath,
    `---
type: notes
month: 2026-04
updated: 2026-04-09
note_count: 0
digested_through: null
---
`
  );

  const result = parseNotesFile(filePath);
  assert.equal(result.entries.length, 0);
});
