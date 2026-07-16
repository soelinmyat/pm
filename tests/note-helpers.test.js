"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("node:child_process");

const {
  writeNote,
  publishReviewedNote,
  parseNotesFile,
  promoteNoteToIdea,
} = require("../scripts/note-helpers.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withTempPmDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "note-test-"));
  const pmDir = path.join(root, "pm");
  const pmStateDir = path.join(root, ".pm");
  return {
    pmDir,
    pmStateDir,
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
    "market observation",
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
  assert.ok(content.includes("market observation"), "heading must contain source type");
  assert.ok(content.includes("Tags: competitor, integration"), "must contain tags");

  // Result must include the file path
  assert.ok(result.filePath, "must return filePath");
  assert.ok(result.timestamp, "must return timestamp");
});

test("writeNote appends second ordinary note to same month, increments note_count", (t) => {
  const { pmDir, cleanup } = withTempPmDir();
  t.after(cleanup);

  writeNote(pmDir, "First note", "observation", "");
  writeNote(pmDir, "Second note", "product observation", "performance");

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

test("writeNote source type appears in heading for an ordinary note", (t) => {
  const { pmDir, cleanup } = withTempPmDir();
  t.after(cleanup);

  writeNote(pmDir, "Product feedback", "field observation", "");

  const notesDir = path.join(pmDir, "evidence", "notes");
  const files = fs.readdirSync(notesDir).filter((f) => f.endsWith(".md"));
  const content = fs.readFileSync(path.join(notesDir, files[0]), "utf8");
  // The heading should be like ### 2026-04-09 14:32 — field observation
  assert.ok(
    /###\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+—\s+field observation/.test(content),
    "heading must contain source type 'field observation'"
  );
});

test("writeNote stores pending customer-sensitive text privately without an artifact binding", (t) => {
  const { pmDir, pmStateDir, cleanup } = withTempPmDir();
  t.after(cleanup);

  const sensitiveText = "Customer alice@example.com needs bulk editing";
  const result = writeNote(pmDir, sensitiveText, "support thread", "editing", {
    pmStateDir,
    now: "2026-07-14T08:00:00.000Z",
    locator: "entry:test-sensitive",
  });
  assert.match(result.evidence_id, /^ev_[a-f0-9]{24}$/);
  assert.equal(result.filePath, null);
  assert.equal(result.pending_review, true);
  assert.equal(fs.existsSync(path.join(pmDir, "evidence", "notes")), false);

  const ledger = JSON.parse(
    fs.readFileSync(path.join(pmDir, "evidence", "provenance.json"), "utf8")
  );
  assert.equal(ledger.records.length, 1);
  assert.equal(ledger.records[0].evidence_id, result.evidence_id);
  assert.deepEqual(ledger.records[0].artifact_paths, []);
  assert.equal(ledger.records[0].privacy.classification, "customer-sensitive");
  assert.equal(ledger.records[0].privacy.pii_review, "pending");
  assert.doesNotMatch(JSON.stringify(ledger), /alice@example\.com/);

  assert.ok(result.privatePath);
  assert.equal(fs.statSync(result.privatePath).mode & 0o777, 0o600);
  assert.match(fs.readFileSync(result.privatePath, "utf8"), /alice@example\.com/);
});

test("publishReviewedNote publishes only sanitized reviewed content and binds it", (t) => {
  const { pmDir, pmStateDir, cleanup } = withTempPmDir();
  t.after(cleanup);
  const raw = "Customer alice@example.com cannot edit 50 rows.";
  const captured = writeNote(pmDir, raw, "customer interview", "editing", {
    pmStateDir,
    now: "2026-07-14T08:00:00.000Z",
    locator: "entry:test-reviewed",
  });

  const published = publishReviewedNote(
    pmDir,
    pmStateDir,
    captured.evidence_id,
    "A customer cannot efficiently edit 50 rows.",
    { source: "customer interview", tags: "editing", now: "2026-07-14T09:00:00.000Z" }
  );

  const note = fs.readFileSync(published.filePath, "utf8");
  assert.match(note, /A customer cannot efficiently edit 50 rows\./);
  assert.doesNotMatch(note, /alice@example\.com/);
  assert.match(note, new RegExp(`Evidence-ID: ${captured.evidence_id}`));
  const ledger = JSON.parse(
    fs.readFileSync(path.join(pmDir, "evidence", "provenance.json"), "utf8")
  );
  const record = ledger.records[0];
  assert.equal(record.privacy.pii_review, "reviewed");
  assert.deepEqual(record.artifact_paths, [path.relative(pmDir, published.filePath)]);
  assert.equal(record.revisions.length, 1);
  assert.doesNotMatch(JSON.stringify(ledger), /alice@example\.com/);

  const retried = publishReviewedNote(
    pmDir,
    pmStateDir,
    captured.evidence_id,
    "A customer cannot efficiently edit 50 rows.",
    { source: "customer interview", tags: "editing", now: "2026-07-14T09:05:00.000Z" }
  );
  assert.equal(retried.filePath, published.filePath);
  assert.equal(parseNotesFile(published.filePath).entries.length, 1);
});

test("publishReviewedNote reconciles an artifact-only partial publication", (t) => {
  const { pmDir, pmStateDir, cleanup } = withTempPmDir();
  t.after(cleanup);
  const captured = writeNote(
    pmDir,
    "Customer identity is private.",
    "customer interview",
    "privacy",
    {
      pmStateDir,
      now: "2026-07-14T08:00:00.000Z",
      locator: "entry:test-partial-publication",
    }
  );
  const notePath = path.join(pmDir, "evidence", "notes", "2026-07.md");
  fs.mkdirSync(path.dirname(notePath), { recursive: true });
  const sanitized = [
    "A customer reported a privacy concern.",
    "Tags: this line is reviewed content",
    "### Embedded heading",
    "Evidence-ID: this is also reviewed content",
    "- **Not enrichment metadata**",
  ].join("\n");
  fs.writeFileSync(
    notePath,
    [
      "---",
      "type: notes",
      "provenance_version: 2",
      "month: 2026-07",
      "updated: 2026-07-14",
      "note_count: 1",
      "digested_through: null",
      "---",
      "",
      `### ${captured.timestamp} — customer interview`,
      sanitized,
      `Evidence-ID: ${captured.evidence_id}`,
      "Tags: privacy",
      "",
    ].join("\n")
  );

  const published = publishReviewedNote(pmDir, pmStateDir, captured.evidence_id, sanitized, {
    source: "customer interview",
    tags: "privacy",
    now: "2026-07-14T09:00:00.000Z",
  });

  assert.equal(published.filePath, notePath);
  assert.equal((fs.readFileSync(notePath, "utf8").match(/^Evidence-ID: ev_/gm) || []).length, 1);
  assert.equal(parseNotesFile(notePath).frontmatter.note_count, "1");
  const ledger = JSON.parse(
    fs.readFileSync(path.join(pmDir, "evidence", "provenance.json"), "utf8")
  );
  assert.equal(ledger.records[0].privacy.pii_review, "reviewed");
  assert.deepEqual(ledger.records[0].artifact_paths, ["evidence/notes/2026-07.md"]);
});

test("publishReviewedNote rejects conflicting duplicate Evidence-ID entries", (t) => {
  const { pmDir, pmStateDir, cleanup } = withTempPmDir();
  t.after(cleanup);
  const captured = writeNote(
    pmDir,
    "Customer identity is private.",
    "customer interview",
    "privacy",
    {
      pmStateDir,
      now: "2026-07-14T08:00:00.000Z",
      locator: "entry:test-duplicate-publication",
    }
  );
  const notePath = path.join(pmDir, "evidence", "notes", "2026-07.md");
  fs.mkdirSync(path.dirname(notePath), { recursive: true });
  fs.writeFileSync(
    notePath,
    [
      "---",
      "type: notes",
      "provenance_version: 2",
      "month: 2026-07",
      "updated: 2026-07-14",
      "note_count: 2",
      "digested_through: null",
      "---",
      "",
      `### ${captured.timestamp} — customer interview`,
      "A customer reported a privacy concern.",
      `Evidence-ID: ${captured.evidence_id}`,
      "Tags: privacy",
      "",
      "### 2026-07-14 17:00 — conflicting entry",
      "Different reviewed content.",
      `Evidence-ID: ${captured.evidence_id}`,
      "",
    ].join("\n")
  );

  assert.throws(
    () =>
      publishReviewedNote(
        pmDir,
        pmStateDir,
        captured.evidence_id,
        "A customer reported a privacy concern.",
        { source: "customer interview", tags: "privacy", now: "2026-07-14T09:00:00.000Z" }
      ),
    /duplicate evidence IDs/i
  );
  const ledger = JSON.parse(
    fs.readFileSync(path.join(pmDir, "evidence", "provenance.json"), "utf8")
  );
  assert.equal(ledger.records[0].privacy.pii_review, "pending");
  assert.deepEqual(ledger.records[0].artifact_paths, []);
});

test("publishReviewedNote rechecks duplicate Evidence-IDs after successful publication", (t) => {
  const { pmDir, pmStateDir, cleanup } = withTempPmDir();
  t.after(cleanup);
  const captured = writeNote(
    pmDir,
    "Customer identity is private.",
    "customer interview",
    "privacy",
    {
      pmStateDir,
      now: "2026-07-14T08:00:00.000Z",
      locator: "entry:test-post-publication-duplicate",
    }
  );
  const options = {
    source: "customer interview",
    tags: "privacy",
    now: "2026-07-14T09:00:00.000Z",
  };
  const published = publishReviewedNote(
    pmDir,
    pmStateDir,
    captured.evidence_id,
    "A customer reported a privacy concern.",
    options
  );
  fs.appendFileSync(
    published.filePath,
    [
      "",
      "### 2026-07-14 17:00 — conflicting entry",
      "Different reviewed content.",
      `Evidence-ID: ${captured.evidence_id}`,
      "",
    ].join("\n")
  );

  assert.throws(
    () =>
      publishReviewedNote(
        pmDir,
        pmStateDir,
        captured.evidence_id,
        "A customer reported a privacy concern.",
        options
      ),
    /duplicate evidence IDs/i
  );
});

test("concurrent note captures do not lose entries or ledger records", async (t) => {
  const { pmDir, cleanup } = withTempPmDir();
  t.after(cleanup);
  const helper = path.resolve(__dirname, "../scripts/note-helpers.js");
  const children = Array.from(
    { length: 6 },
    (_, index) =>
      new Promise((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            "-e",
            "const {writeNote}=require(process.argv[1]);writeNote(process.argv[2],process.argv[3],'observation','concurrency')",
            helper,
            pmDir,
            `Concurrent note ${index}`,
          ],
          { stdio: ["ignore", "ignore", "pipe"] }
        );
        let stderr = "";
        child.stderr.on("data", (chunk) => (stderr += chunk));
        child.on("error", reject);
        child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(stderr))));
      })
  );
  await Promise.all(children);

  const noteFile = fs.readdirSync(path.join(pmDir, "evidence", "notes"))[0];
  const parsed = parseNotesFile(path.join(pmDir, "evidence", "notes", noteFile));
  assert.equal(parsed.entries.length, 6);
  assert.equal(new Set(parsed.entries.map((entry) => entry.evidence_id)).size, 6);
  const ledger = JSON.parse(
    fs.readFileSync(path.join(pmDir, "evidence", "provenance.json"), "utf8")
  );
  assert.equal(ledger.records.length, 6);
});

test("note promotion and Task capture share one backlog ID transaction", async (t) => {
  const { pmDir, cleanup } = withTempPmDir();
  t.after(cleanup);
  const notesDir = path.join(pmDir, "evidence", "notes");
  fs.mkdirSync(notesDir, { recursive: true });
  const noteFile = path.join(notesDir, "2026-04.md");
  fs.writeFileSync(
    noteFile,
    `---
type: notes
month: 2026-04
updated: 2026-04-14
note_count: 1
digested_through: null
---

### 2026-04-14 09:00 — observation
Promote this independent signal.
Tags: insight
`
  );
  const start = path.join(path.dirname(pmDir), "start");
  const noteHelper = path.resolve(__dirname, "../scripts/note-helpers.js");
  const captureHelper = path.resolve(__dirname, "../scripts/capture-backlog.js");
  const waitPrefix =
    "const fs=require('node:fs');while(!fs.existsSync(process.argv[1]))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,5);";
  const children = [
    [
      "-e",
      `${waitPrefix}const write=fs.writeFileSync.bind(fs);fs.writeFileSync=(file,...rest)=>{if(String(file).includes('/backlog/')&&String(file).endsWith('.tmp'))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,200);return write(file,...rest)};require(process.argv[2]).promoteNoteToIdea(process.argv[3],process.argv[4],'2026-04-14 09:00')`,
      start,
      noteHelper,
      pmDir,
      noteFile,
    ],
    ...Array.from({ length: 6 }, (_, index) => [
      "-e",
      `${waitPrefix}require(process.argv[2]).captureBacklogItem(process.argv[3],{kind:'task',title:process.argv[4]})`,
      start,
      captureHelper,
      pmDir,
      `Concurrent task ${index}`,
    ]),
  ].map(
    (args) =>
      new Promise((resolve, reject) => {
        const child = spawn(process.execPath, args, { stdio: ["ignore", "ignore", "pipe"] });
        let stderr = "";
        child.stderr.on("data", (chunk) => (stderr += chunk));
        child.on("error", reject);
        child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(stderr))));
      })
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  fs.writeFileSync(start, "go");
  await Promise.all(children);

  const ids = fs
    .readdirSync(path.join(pmDir, "backlog"))
    .filter((name) => name.endsWith(".md"))
    .map(
      (name) =>
        fs
          .readFileSync(path.join(pmDir, "backlog", name), "utf8")
          .match(/^id:\s*['"]?(PM-\d+)/m)?.[1]
    );
  assert.equal(ids.length, 7);
  assert.equal(new Set(ids).size, 7);
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

// ---------------------------------------------------------------------------
// parseNotesFile — Promoted-to parsing
// ---------------------------------------------------------------------------

test("parseNotesFile parses Promoted-to field when present", (t) => {
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
updated: 2026-04-14
note_count: 2
digested_through: null
---

### 2026-04-14 09:00 — groom-opportunity
Immediate startability as a differentiator.
Tags: strategy
Promoted-to: immediate-startability

### 2026-04-14 09:05 — groom-opportunity
Cross-pillar integration opportunities.
Tags: integration
`
  );

  const result = parseNotesFile(filePath);
  assert.equal(result.entries.length, 2);
  assert.equal(result.entries[0].promoted_to, "immediate-startability");
  assert.equal(result.entries[1].promoted_to, undefined);
});

test("parseNotesFile returns undefined promoted_to for notes without Promoted-to", (t) => {
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
updated: 2026-04-14
note_count: 1
digested_through: null
---

### 2026-04-14 10:00 — observation
Regular observation note.
Tags: general
`
  );

  const result = parseNotesFile(filePath);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].promoted_to, undefined);
});

// ---------------------------------------------------------------------------
// promoteNoteToIdea tests
// ---------------------------------------------------------------------------

test("promoteNoteToIdea creates a backlog idea and marks note as promoted", (t) => {
  const { pmDir, cleanup } = withTempPmDir();
  t.after(cleanup);

  const notesDir = path.join(pmDir, "evidence", "notes");
  fs.mkdirSync(notesDir, { recursive: true });
  const noteFile = path.join(notesDir, "2026-04.md");
  fs.writeFileSync(
    noteFile,
    `---
type: notes
month: 2026-04
updated: 2026-04-14
note_count: 1
digested_through: null
---

### 2026-04-14 09:00 — groom-opportunity
Immediate startability as a differentiator.
Tags: strategy, onboarding
`
  );

  const result = promoteNoteToIdea(pmDir, noteFile, "2026-04-14 09:00");

  // Check return value
  assert.equal(result.slug, "immediate-startability-as-a");
  assert.equal(result.id, "PM-001");
  assert.ok(result.backlogPath.endsWith("immediate-startability-as-a.md"));

  // Check backlog file was created
  assert.ok(fs.existsSync(result.backlogPath), "backlog file must exist");
  const backlogContent = fs.readFileSync(result.backlogPath, "utf8");
  assert.ok(backlogContent.includes("type: backlog"), "must have type: backlog");
  assert.ok(backlogContent.includes("id: PM-001"), "must have correct ID");
  assert.ok(backlogContent.includes("status: idea"), "must have status: idea");
  assert.ok(backlogContent.includes("source_note:"), "must have source_note");

  // Check note was updated with Promoted-to
  const updatedNote = fs.readFileSync(noteFile, "utf8");
  assert.ok(
    updatedNote.includes("Promoted-to: immediate-startability-as-a"),
    "note must be marked as promoted"
  );
});

test("promoteNoteToIdea assigns next sequential ID", (t) => {
  const { pmDir, cleanup } = withTempPmDir();
  t.after(cleanup);

  // Pre-create a backlog item with PM-005
  const backlogDir = path.join(pmDir, "backlog");
  fs.mkdirSync(backlogDir, { recursive: true });
  fs.writeFileSync(
    path.join(backlogDir, "existing-feature.md"),
    `---
type: backlog
id: PM-005
title: Existing feature
outcome: null
status: idea
priority: medium
labels:
  - test
created: 2026-04-10
updated: 2026-04-10
---
`
  );

  const notesDir = path.join(pmDir, "evidence", "notes");
  fs.mkdirSync(notesDir, { recursive: true });
  const noteFile = path.join(notesDir, "2026-04.md");
  fs.writeFileSync(
    noteFile,
    `---
type: notes
month: 2026-04
updated: 2026-04-14
note_count: 1
digested_through: null
---

### 2026-04-14 11:00 — groom-opportunity
Better onboarding flow for new users.
Tags: onboarding
`
  );

  const result = promoteNoteToIdea(pmDir, noteFile, "2026-04-14 11:00");
  assert.equal(result.id, "PM-006", "ID must be next in sequence");
});

test("promoteNoteToIdea throws if entry is already promoted", (t) => {
  const { pmDir, cleanup } = withTempPmDir();
  t.after(cleanup);

  const notesDir = path.join(pmDir, "evidence", "notes");
  fs.mkdirSync(notesDir, { recursive: true });
  const noteFile = path.join(notesDir, "2026-04.md");
  fs.writeFileSync(
    noteFile,
    `---
type: notes
month: 2026-04
updated: 2026-04-14
note_count: 1
digested_through: null
---

### 2026-04-14 09:00 — groom-opportunity
Already promoted note.
Tags: test
Promoted-to: already-promoted
`
  );

  assert.throws(() => promoteNoteToIdea(pmDir, noteFile, "2026-04-14 09:00"), /already promoted/);
});

test("promoteNoteToIdea throws on slug collision with existing backlog file", (t) => {
  const { pmDir, cleanup } = withTempPmDir();
  t.after(cleanup);

  // Pre-create a backlog file that would collide
  const backlogDir = path.join(pmDir, "backlog");
  fs.mkdirSync(backlogDir, { recursive: true });
  fs.writeFileSync(
    path.join(backlogDir, "immediate-startability-as-a.md"),
    "---\ntype: backlog\nid: PM-001\n---\n"
  );

  const notesDir = path.join(pmDir, "evidence", "notes");
  fs.mkdirSync(notesDir, { recursive: true });
  const noteFile = path.join(notesDir, "2026-04.md");
  fs.writeFileSync(
    noteFile,
    `---
type: notes
month: 2026-04
updated: 2026-04-14
note_count: 1
digested_through: null
---

### 2026-04-14 09:00 — groom-opportunity
Immediate startability as a differentiator.
Tags: strategy
`
  );

  assert.throws(() => promoteNoteToIdea(pmDir, noteFile, "2026-04-14 09:00"), /slug collision/);
});

test("promoteNoteToIdea handles middle entry in multi-entry file", (t) => {
  const { pmDir, cleanup } = withTempPmDir();
  t.after(cleanup);

  const notesDir = path.join(pmDir, "evidence", "notes");
  fs.mkdirSync(notesDir, { recursive: true });
  const noteFile = path.join(notesDir, "2026-04.md");
  fs.writeFileSync(
    noteFile,
    `---
type: notes
month: 2026-04
updated: 2026-04-14
note_count: 3
digested_through: null
---

### 2026-04-14 09:00 — groom-opportunity
First opportunity note.
Tags: first

### 2026-04-14 09:05 — groom-opportunity
Second opportunity to promote.
Tags: second

### 2026-04-14 09:10 — groom-opportunity
Third opportunity note.
Tags: third
`
  );

  // Promote the middle entry
  const result = promoteNoteToIdea(pmDir, noteFile, "2026-04-14 09:05");
  assert.ok(result.slug, "must return a slug");

  // Verify only the middle entry is marked
  const updated = fs.readFileSync(noteFile, "utf8");
  const lines = updated.split("\n");

  // Find the Promoted-to line and verify it's between entry 2 and entry 3
  const promotedIdx = lines.findIndex((l) => l.startsWith("Promoted-to:"));
  assert.ok(promotedIdx > -1, "Promoted-to line must exist");

  // Entry 1 and 3 should not have Promoted-to
  const parsed = require("../scripts/note-helpers.js").parseNotesFile(noteFile);
  assert.equal(parsed.entries[0].promoted_to, undefined, "first entry must not be promoted");
  assert.ok(parsed.entries[1].promoted_to, "second entry must be promoted");
  assert.equal(parsed.entries[2].promoted_to, undefined, "third entry must not be promoted");
});

test("promoteNoteToIdea throws on empty note body", (t) => {
  const { pmDir, cleanup } = withTempPmDir();
  t.after(cleanup);

  const notesDir = path.join(pmDir, "evidence", "notes");
  fs.mkdirSync(notesDir, { recursive: true });
  const noteFile = path.join(notesDir, "2026-04.md");
  // Note with punctuation-only body that slugifies to empty
  fs.writeFileSync(
    noteFile,
    `---
type: notes
month: 2026-04
updated: 2026-04-14
note_count: 1
digested_through: null
---

### 2026-04-14 09:00 — groom-opportunity
...
Tags: test
`
  );

  assert.throws(() => promoteNoteToIdea(pmDir, noteFile, "2026-04-14 09:00"), /Cannot derive slug/);
});

test("promoteNoteToIdea throws if entry timestamp not found", (t) => {
  const { pmDir, cleanup } = withTempPmDir();
  t.after(cleanup);

  const notesDir = path.join(pmDir, "evidence", "notes");
  fs.mkdirSync(notesDir, { recursive: true });
  const noteFile = path.join(notesDir, "2026-04.md");
  fs.writeFileSync(
    noteFile,
    `---
type: notes
month: 2026-04
updated: 2026-04-14
note_count: 1
digested_through: null
---

### 2026-04-14 09:00 — observation
Some note.
`
  );

  assert.throws(() => promoteNoteToIdea(pmDir, noteFile, "2026-04-14 99:99"), /not found/);
});
