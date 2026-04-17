"use strict";

// PM-51 Issue 4 — dev routing by backlog `kind`.
// Exercises the decision logic at a parse-and-assert level, not full orchestration.
// Each fixture represents a backlog frontmatter state; we assert that resolveKind
// returns the expected value and that the step-file prompts contain the required
// routing language so the orchestrator agent will behave correctly at runtime.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { parseFrontmatter } = require("../scripts/kb-frontmatter.js");
const { resolveKind } = require("../scripts/validate.js");

const FIXTURE_DIR = path.join(__dirname, "fixtures", "backlog-kind");
const STEP_DIR = path.join(__dirname, "..", "skills", "dev", "steps");

function readFm(name) {
  const full = path.join(FIXTURE_DIR, name);
  const parsed = parseFrontmatter(fs.readFileSync(full, "utf8"));
  return parsed.data;
}

function readStep(name) {
  return fs.readFileSync(path.join(STEP_DIR, name), "utf8");
}

// Codified decision matrix — matches the step-file routing language.
function routeForKind(kind) {
  const k = resolveKind({ kind });
  if (k === "task" || k === "bug") {
    return {
      resolvedKind: k,
      groomReadiness: "skip",
      simplify: "skip",
      review: "force-full",
    };
  }
  return {
    resolvedKind: "proposal",
    groomReadiness: "size-routed",
    simplify: "size-routed",
    review: "size-routed",
  };
}

// ---------------------------------------------------------------------------
// Fixtures — resolveKind + routing decisions
// ---------------------------------------------------------------------------

test("PM-51 routing: fixture proposal → resolved kind = proposal, feature path", () => {
  const fm = readFm("proposal.md");
  assert.equal(resolveKind(fm), "proposal");
  const r = routeForKind(fm.kind);
  assert.equal(r.resolvedKind, "proposal");
  assert.equal(r.groomReadiness, "size-routed");
  assert.equal(r.simplify, "size-routed");
  assert.equal(r.review, "size-routed");
});

test("PM-51 routing: fixture task → resolved kind = task, lightweight path", () => {
  const fm = readFm("task.md");
  assert.equal(resolveKind(fm), "task");
  const r = routeForKind(fm.kind);
  assert.equal(r.resolvedKind, "task");
  assert.equal(r.groomReadiness, "skip");
  assert.equal(r.simplify, "skip");
  assert.equal(r.review, "force-full");
});

test("PM-51 routing: fixture bug → resolved kind = bug, lightweight path", () => {
  const fm = readFm("bug.md");
  assert.equal(resolveKind(fm), "bug");
  const r = routeForKind(fm.kind);
  assert.equal(r.resolvedKind, "bug");
  assert.equal(r.groomReadiness, "skip");
  assert.equal(r.simplify, "skip");
  assert.equal(r.review, "force-full");
});

test("PM-51 routing AC6: fixture no-kind → resolved kind = proposal (feature path)", () => {
  const fm = readFm("no-kind.md");
  assert.equal(fm.kind, undefined, "fixture must omit the kind field");
  assert.equal(resolveKind(fm), "proposal");
  const r = routeForKind(fm.kind);
  assert.equal(r.resolvedKind, "proposal");
  assert.equal(r.groomReadiness, "size-routed");
  assert.equal(r.simplify, "size-routed");
  assert.equal(r.review, "size-routed");
});

test("PM-51 routing AC7: kind=task + size=L → kind wins, lightweight path", () => {
  const fm = readFm("task-sized-L.md");
  assert.equal(resolveKind(fm), "task");
  assert.equal(fm.size, "L");
  const r = routeForKind(fm.kind);
  assert.equal(r.groomReadiness, "skip");
  assert.equal(r.simplify, "skip");
  assert.equal(r.review, "force-full");
});

// ---------------------------------------------------------------------------
// Step-file contract — the routing language the orchestrator reads at runtime
// ---------------------------------------------------------------------------

test("PM-51 routing: 02-intake persists resolved kind and handles kind × size collision", () => {
  const text = readStep("02-intake.md");
  assert.match(text, /resolveKind/);
  assert.match(text, /kind.*task.*kind.*bug/i);
  assert.match(text, /Routing by kind/);
  assert.match(text, /overrides size/i);
  assert.match(text, /Warning: kind=.*overrides size=/);
});

test("PM-51 routing: 04-groom-readiness short-circuits on task/bug", () => {
  const text = readStep("04-groom-readiness.md");
  assert.match(text, /Kind short-circuit/);
  assert.match(text, /kind.*task.*kind.*bug/i);
  assert.match(text, /skipped-kind-/);
  assert.match(text, /jump.*to.*Implementation/i);
});

test("PM-51 routing: 06-simplify skips on task/bug regardless of size", () => {
  const text = readStep("06-simplify.md");
  assert.match(text, /Kind skip/);
  assert.match(text, /kind.*task.*kind.*bug/i);
  assert.match(text, /skipped-kind-/);
  assert.match(text, /regardless of size/i);
});

test("PM-51 routing: 07-review forces pm:review on task/bug regardless of size", () => {
  const text = readStep("07-review.md");
  assert.match(text, /Kind override/);
  assert.match(text, /kind.*task.*kind.*bug/i);
  assert.match(text, /forced-kind-/);
  assert.match(text, /regardless of size/i);
  assert.match(text, /do not fall to the XS code-scan path/i);
});

// ---------------------------------------------------------------------------
// Regression — existing feature path must be observationally identical
// ---------------------------------------------------------------------------

test("PM-51 routing regression: proposal kind still runs size-based routing", () => {
  const r = routeForKind("proposal");
  assert.equal(r.simplify, "size-routed");
  assert.equal(r.review, "size-routed");
});

test("PM-51 routing regression: absent/null kind still runs size-based routing", () => {
  assert.equal(routeForKind(undefined).simplify, "size-routed");
  assert.equal(routeForKind(null).simplify, "size-routed");
});
