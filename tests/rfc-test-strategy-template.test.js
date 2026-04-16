"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Issue 1 regression tests: Test Strategy section in rfc-template.md and
// rfc-reference.html. Validates D1 (five subsections), D2 (per-issue hooks),
// D5 (schema-v2 marker), D7 (canonical schema comment).
// ---------------------------------------------------------------------------

const PLUGIN_ROOT = path.resolve(__dirname, "..");
const TEMPLATE_PATH = path.join(
  PLUGIN_ROOT,
  "references",
  "templates",
  "rfc-template.md"
);
const REFERENCE_PATH = path.join(
  PLUGIN_ROOT,
  "references",
  "templates",
  "rfc-reference.html"
);

// The five canonical subsection names from D1
const SUBSECTIONS = [
  "Test levels in scope",
  "New test infrastructure",
  "Regression surface",
  "Verification commands",
  "Open test questions",
];

// ---------------------------------------------------------------------------
// rfc-template.md tests
// ---------------------------------------------------------------------------

test("rfc-template.md: has ## Test Strategy section", () => {
  const content = fs.readFileSync(TEMPLATE_PATH, "utf8");
  assert.ok(
    content.includes("## Test Strategy"),
    "Template must contain a ## Test Strategy section"
  );
});

test("rfc-template.md: Test Strategy is between Risks and Issues", () => {
  const content = fs.readFileSync(TEMPLATE_PATH, "utf8");
  const risksIdx = content.indexOf("## Risks");
  const testStratIdx = content.indexOf("## Test Strategy");
  const issuesIdx = content.indexOf("## Issues");

  assert.ok(risksIdx > -1, "## Risks must exist");
  assert.ok(testStratIdx > -1, "## Test Strategy must exist");
  assert.ok(issuesIdx > -1, "## Issues must exist");
  assert.ok(
    testStratIdx > risksIdx,
    "Test Strategy must come after Risks"
  );
  assert.ok(
    testStratIdx < issuesIdx,
    "Test Strategy must come before Issues"
  );
});

test("rfc-template.md: has all five D1 subsections", () => {
  const content = fs.readFileSync(TEMPLATE_PATH, "utf8");
  for (const sub of SUBSECTIONS) {
    assert.ok(
      content.includes(`### ${sub}`),
      `Template must contain subsection: ### ${sub}`
    );
  }
});

test("rfc-template.md: has canonical schema v2 HTML comment (D7)", () => {
  const content = fs.readFileSync(TEMPLATE_PATH, "utf8");
  assert.ok(
    content.includes(
      "<!-- canonical: schema v2"
    ),
    "Template must contain the canonical schema v2 HTML comment"
  );
});

test("rfc-template.md: per-issue Test hooks field exists (D2)", () => {
  const content = fs.readFileSync(TEMPLATE_PATH, "utf8");
  assert.ok(
    content.includes("**Test hooks:**"),
    "Template issue example must contain a Test hooks field"
  );
});

// ---------------------------------------------------------------------------
// rfc-reference.html tests
// ---------------------------------------------------------------------------

test("rfc-reference.html: has section id=test-strategy", () => {
  const content = fs.readFileSync(REFERENCE_PATH, "utf8");
  assert.ok(
    content.includes('id="test-strategy"'),
    "HTML reference must contain section id=test-strategy"
  );
});

test("rfc-reference.html: test-strategy section is between risks and issues", () => {
  const content = fs.readFileSync(REFERENCE_PATH, "utf8");
  const risksIdx = content.indexOf('id="risks"');
  const testStratIdx = content.indexOf('id="test-strategy"');
  const issuesIdx = content.indexOf('id="issues"');

  assert.ok(risksIdx > -1, 'id="risks" must exist');
  assert.ok(testStratIdx > -1, 'id="test-strategy" must exist');
  assert.ok(issuesIdx > -1, 'id="issues" must exist');
  assert.ok(
    testStratIdx > risksIdx,
    "test-strategy must come after risks"
  );
  assert.ok(
    testStratIdx < issuesIdx,
    "test-strategy must come before issues"
  );
});

test("rfc-reference.html: has five .test-strategy-block elements", () => {
  const content = fs.readFileSync(REFERENCE_PATH, "utf8");
  const matches = content.match(/class="test-strategy-block"/g);
  assert.ok(matches, "Must have .test-strategy-block elements");
  assert.equal(
    matches.length,
    5,
    `Expected 5 test-strategy-block elements, got ${matches.length}`
  );
});

test("rfc-reference.html: has data-schema-version=2 on root element", () => {
  const content = fs.readFileSync(REFERENCE_PATH, "utf8");
  assert.ok(
    content.includes('data-schema-version="2"'),
    "HTML reference must have data-schema-version=2"
  );
});

test("rfc-reference.html: has script#rfc-meta JSON block", () => {
  const content = fs.readFileSync(REFERENCE_PATH, "utf8");
  assert.ok(
    content.includes('id="rfc-meta"'),
    "HTML reference must have script#rfc-meta"
  );
});

test("rfc-reference.html: TOC has #test-strategy link", () => {
  const content = fs.readFileSync(REFERENCE_PATH, "utf8");
  assert.ok(
    content.includes('href="#test-strategy"'),
    "TOC must include a #test-strategy link"
  );
});

test("rfc-reference.html: issue-detail cards have .hooks-badge", () => {
  const content = fs.readFileSync(REFERENCE_PATH, "utf8");
  const matches = content.match(/class="hooks-badge"/g);
  assert.ok(matches, "Must have .hooks-badge elements in issue-detail cards");
  assert.ok(
    matches.length >= 2,
    `Expected at least 2 hooks-badge elements (one per issue-detail), got ${matches.length}`
  );
});

test("rfc-reference.html: has .hooks-badge CSS class defined", () => {
  const content = fs.readFileSync(REFERENCE_PATH, "utf8");
  assert.ok(
    content.includes(".hooks-badge"),
    "CSS must define .hooks-badge class"
  );
});

test("rfc-reference.html: has .test-strategy-block CSS class defined", () => {
  const content = fs.readFileSync(REFERENCE_PATH, "utf8");
  assert.ok(
    content.includes(".test-strategy-block"),
    "CSS must define .test-strategy-block class"
  );
});

test("rfc-reference.html: has .icon-test CSS class defined", () => {
  const content = fs.readFileSync(REFERENCE_PATH, "utf8");
  assert.ok(
    content.includes(".icon-test"),
    "CSS must define .icon-test class"
  );
});
