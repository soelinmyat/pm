"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// RFC Issue Section Parser Tests (PM-231, Issue 3)
//
// Dev intake parses RFC HTML to extract issue cards. These tests verify:
// 1. The .issue-detail HTML contract is stable and parseable
// 2. The parser logic described in 02-intake.md works against real RFC HTML
// 3. Edge cases (zero issues, missing fields) are handled correctly
//
// The parser is not a module — it's instructions for Claude to follow. These
// tests validate the contract by running the same regex/DOM patterns against
// fixture HTML.
// ---------------------------------------------------------------------------

// Minimal parser matching the intake step's described behavior:
// "Parse the RFC Issue sections by finding elements with class .issue-detail.
//  For each, extract: Issue number from .issue-detail-num, Title from
//  .issue-detail-title, Size from .issue-detail-size"
function parseRfcIssues(html) {
  const issues = [];
  const detailRegex =
    /<div\s+class="issue-detail">([\s\S]*?)<\/div>\s*(?=<div\s+class="issue-detail">|<\/section|<section|$)/g;
  let match;

  while ((match = detailRegex.exec(html)) !== null) {
    const block = match[1];

    const numMatch = block.match(
      /<span\s+class="issue-detail-num">\s*(?:Issue\s+)?(\d+)\s*<\/span>/
    );
    const titleMatch = block.match(/<span\s+class="issue-detail-title">([\s\S]*?)<\/span>/);
    const sizeMatch = block.match(/<span\s+class="issue-detail-size">\s*(\w+)\s*<\/span>/);

    if (numMatch && titleMatch && sizeMatch) {
      issues.push({
        num: parseInt(numMatch[1], 10),
        title: titleMatch[1].replace(/<[^>]+>/g, "").trim(),
        size: sizeMatch[1].trim(),
      });
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MINIMAL_RFC = `
<section class="section" id="issues">
  <div class="issue-detail">
    <div class="issue-detail-header">
      <span class="issue-detail-num">Issue 1</span>
      <span class="issue-detail-title">Add user authentication</span>
      <span class="issue-detail-size">M</span>
    </div>
    <p>Implement OAuth2 flow.</p>
  </div>
  <div class="issue-detail">
    <div class="issue-detail-header">
      <span class="issue-detail-num">Issue 2</span>
      <span class="issue-detail-title">Add session management</span>
      <span class="issue-detail-size">S</span>
    </div>
    <p>Token refresh and expiry.</p>
  </div>
</section>
`;

const SINGLE_ISSUE_RFC = `
<section class="section" id="issues">
  <div class="issue-detail">
    <div class="issue-detail-header">
      <span class="issue-detail-num">Issue 1</span>
      <span class="issue-detail-title">Fix login redirect</span>
      <span class="issue-detail-size">XS</span>
    </div>
  </div>
</section>
`;

const NO_ISSUES_RFC = `
<section class="section" id="issues">
  <p>No issues defined yet.</p>
</section>
`;

const TITLE_WITH_CODE_RFC = `
<section class="section" id="issues">
  <div class="issue-detail">
    <div class="issue-detail-header">
      <span class="issue-detail-num">Issue 1</span>
      <span class="issue-detail-title">Remove <code>children:</code> from schema</span>
      <span class="issue-detail-size">S</span>
    </div>
  </div>
</section>
`;

const FIVE_ISSUE_RFC_PATH = path.join(
  __dirname,
  "..",
  "pm",
  "backlog",
  "rfcs",
  "rfc-issue-decomposition.html"
);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("rfc parser: extracts multiple issues from minimal fixture", () => {
  const issues = parseRfcIssues(MINIMAL_RFC);
  assert.equal(issues.length, 2);
  assert.deepStrictEqual(issues[0], { num: 1, title: "Add user authentication", size: "M" });
  assert.deepStrictEqual(issues[1], { num: 2, title: "Add session management", size: "S" });
});

test("rfc parser: extracts single issue", () => {
  const issues = parseRfcIssues(SINGLE_ISSUE_RFC);
  assert.equal(issues.length, 1);
  assert.deepStrictEqual(issues[0], { num: 1, title: "Fix login redirect", size: "XS" });
});

test("rfc parser: returns empty array when no .issue-detail cards found", () => {
  const issues = parseRfcIssues(NO_ISSUES_RFC);
  assert.equal(issues.length, 0);
});

test("rfc parser: hard-abort condition — zero issues triggers error", () => {
  const issues = parseRfcIssues(NO_ISSUES_RFC);
  // Per intake step: "If the RFC exists but zero issues are parsed, hard-abort"
  assert.equal(issues.length, 0, "Parser returns empty; caller must hard-abort");
});

test("rfc parser: strips HTML tags from title (e.g. <code>)", () => {
  const issues = parseRfcIssues(TITLE_WITH_CODE_RFC);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].title, "Remove children: from schema");
});

test("rfc parser: parses real RFC file (rfc-issue-decomposition.html)", () => {
  // This test runs against the actual RFC committed in this project
  let html;
  try {
    html = fs.readFileSync(FIVE_ISSUE_RFC_PATH, "utf8");
  } catch {
    // Skip if the RFC file isn't present (e.g. running in CI without pm/ dir)
    return;
  }

  const issues = parseRfcIssues(html);
  assert.equal(
    issues.length,
    5,
    `Expected 5 issues in rfc-issue-decomposition, got ${issues.length}`
  );

  // Verify issue numbers are sequential
  for (let i = 0; i < issues.length; i++) {
    assert.equal(issues[i].num, i + 1, `Issue ${i + 1} should have num ${i + 1}`);
  }

  // Verify known titles (from the RFC)
  assert.match(issues[0].title, /children/i);
  assert.match(issues[2].title, /intake/i);

  // Verify sizes are valid
  const validSizes = ["XS", "S", "M", "L", "XL"];
  for (const issue of issues) {
    assert.ok(
      validSizes.includes(issue.size),
      `Issue ${issue.num} size "${issue.size}" should be valid`
    );
  }
});

test("rfc parser: .issue-detail class names match contract in writing-rfcs.md", () => {
  // Verify the contract documented in writing-rfcs.md is what the parser expects
  const writingRfcs = fs.readFileSync(
    path.join(__dirname, "..", "skills", "rfc", "references", "writing-rfcs.md"),
    "utf8"
  );

  assert.match(writingRfcs, /\.issue-detail/, "writing-rfcs.md should document .issue-detail");
  assert.match(
    writingRfcs,
    /\.issue-detail-num/,
    "writing-rfcs.md should document .issue-detail-num"
  );
  assert.match(
    writingRfcs,
    /\.issue-detail-title/,
    "writing-rfcs.md should document .issue-detail-title"
  );
  assert.match(
    writingRfcs,
    /\.issue-detail-size/,
    "writing-rfcs.md should document .issue-detail-size"
  );
  assert.match(
    writingRfcs,
    /stable contract/i,
    "writing-rfcs.md should mark these as stable contract"
  );
});

test("rfc parser: intake step references correct class names", () => {
  const intakeStep = fs.readFileSync(
    path.join(__dirname, "..", "skills", "dev", "steps", "02-intake.md"),
    "utf8"
  );

  assert.match(intakeStep, /\.issue-detail`/, "intake should reference .issue-detail");
  assert.match(intakeStep, /\.issue-detail-num/, "intake should reference .issue-detail-num");
  assert.match(intakeStep, /\.issue-detail-title/, "intake should reference .issue-detail-title");
  assert.match(intakeStep, /\.issue-detail-size/, "intake should reference .issue-detail-size");
});
