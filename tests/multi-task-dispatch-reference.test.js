"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// ---------------------------------------------------------------------------
// D5 Slice 2 — the multi-task subprocess machinery was extracted out of the
// always-loaded step 05-implementation.md into references/multi-task-dispatch.md
// (loaded ONLY on the multi-task branch). This file is the relocated guard: the
// keyword pins that used to sit in dev-steps-regression's CRITICAL_KEYWORDS
// (e.g. "Sequential execution") now live here, against the reference itself, so
// accidental deletion of the machinery is still caught.
// ---------------------------------------------------------------------------

const repoRoot = path.resolve(__dirname, "..");
const REFERENCE = "skills/dev/references/multi-task-dispatch.md";

function read(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("multi-task-dispatch reference exists and is not a numbered step", () => {
  assert.ok(
    fs.existsSync(path.join(repoRoot, REFERENCE)),
    "multi-task machinery must live in references/multi-task-dispatch.md"
  );
  // A reference is not a workflow step: no numbered filename, no order frontmatter.
  const stepPath = path.join(repoRoot, "skills", "dev", "steps");
  const stepFiles = fs.readdirSync(stepPath).filter((f) => f.endsWith(".md"));
  assert.ok(
    !stepFiles.includes("multi-task-dispatch.md"),
    "the reference must NOT be a numbered step file (steps.length is pinned at 8)"
  );
  const text = read(REFERENCE);
  assert.doesNotMatch(text, /^order:\s*\d+/m, "reference must not carry step `order` frontmatter");
});

test("05 routes the multi-task branch at the reference (relocated, not lost)", () => {
  const step = read("skills/dev/steps/05-implementation.md");
  // The always-loaded step stays a thin router: it must point at the reference
  // and still name the branch condition + sequential nature for the reader.
  assert.match(step, /skills\/dev\/references\/multi-task-dispatch\.md/);
  assert.match(step, /task_count > 1/);
  assert.match(step, /Sequential execution/);
});

test("reference pins the relocated Sequential execution machinery keyword", () => {
  const text = read(REFERENCE);
  // The exact CRITICAL_KEYWORDS pin that moved out of the step-body test.
  assert.match(text, /Sequential execution/);
  assert.match(text, /Environment readiness check/);
  assert.match(text, /Skip fully-implemented tasks/);
  assert.match(text, /Claude subscription usage note/);
  assert.match(text, /Per-task lifecycle tracking/);
  assert.match(text, /Agent failure recovery/);
  assert.match(text, /Max 3 total attempts per task/);
});

test("reference carries the per-issue prompt template with its lifecycle", () => {
  const text = read(REFERENCE);
  assert.match(text, /Build the per-issue prompt/);
  // Result contract both branches.
  assert.match(text, /"status":"merged"/);
  assert.match(text, /"status":"blocked"/);
  // Lifecycle-stage recovery marker + the valid stage vocabulary.
  assert.match(text, /\.dev-lifecycle-stage/);
  assert.match(text, /setup, implement, design-critique, qa, review, ship, cleanup/);
  // Runtime dispatch/wait scripts.
  assert.match(text, /scripts\/dispatch-issue\.sh/);
  assert.match(text, /scripts\/dispatch-wait\.sh/);
});

test("reference keeps the dispatch-wait branch table (done/crashed/running + edges)", () => {
  const text = read(REFERENCE);
  const table = text.match(/\| Helper output \|[\s\S]*?blocked`\}[\s\S]*?\n\n/);
  assert.ok(table, "the helper-output branch table must be present in the reference");
  assert.match(table[0], /state=done/);
  assert.match(table[0], /state=crashed/);
  assert.match(table[0], /state=running/);
  // done nests the parsed result; crashed halts; running re-invokes (heartbeat).
  assert.match(table[0], /halt epic/i);
  assert.match(table[0], /Re-invoke/i);
  // The two review-added edge rows: unparseable output and out-of-contract status.
  assert.match(table[0], /output missing or unparseable[\s\S]*Treat as `crashed`/);
  assert.match(table[0], /status` ∉ \{`merged`, `blocked`\}[\s\S]*Treat as `blocked`/);
});

test("reference restores the branch-before-refire discipline", () => {
  const text = read(REFERENCE);
  assert.match(text, /Branch on `\.state` BEFORE anything else/);
  assert.match(text, /Never reflexively re-invoke/i);
  assert.match(text, /agent-runtime\.md` § Subprocess Dispatch HARD-RULE/);
});

test("reference prompt template requires an atomic result write (tmp then mv)", () => {
  const text = read(REFERENCE);
  assert.match(text, /\$\{RESULT_FILE\}\.tmp then `mv`/);
  assert.match(text, /never reads a half-written file/);
});

test("reference stop-list scopes out Step 08-class stops", () => {
  const text = read(REFERENCE);
  assert.match(text, /the ones Step 05 enumerates that apply here/);
  assert.match(
    text,
    /Step 08-class stops \(merge conflicts, CI failures, human review feedback\) are handled inside each subprocess/
  );
});

test("reference points at agent-runtime.md as the canonical machinery source", () => {
  const text = read(REFERENCE);
  assert.match(text, /agent-runtime\.md` § Subprocess Dispatch/);
});

// The dev headless Loop Worker contract is implement-only and non-interactive;
// nothing extracted from 05 may drop that discipline on the multi-task path.
test("reference carries the non-interactive discipline 05 had", () => {
  const text = read(REFERENCE);
  assert.match(text, /Non-interactive discipline/);
  assert.match(text, /without pausing for user input/);
  assert.match(text, /never treat silence as approval/i);
  assert.match(text, /Loop Worker Mode/);
  assert.match(text, /needs-human/);
});
