"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const PLUGIN_ROOT = path.resolve(__dirname, "..");

function read(relPath) {
  return fs.readFileSync(path.join(PLUGIN_ROOT, relPath), "utf8");
}

function assertInOrder(content, labels) {
  let previous = -1;
  for (const label of labels) {
    const current = content.indexOf(label);
    assert.ok(current > -1, `Missing expected label: ${label}`);
    assert.ok(current > previous, `Expected ${label} to appear after prior label`);
    previous = current;
  }
}

test("proposal format documents the three layered reader paths", () => {
  const content = read("skills/groom/references/proposal-format.md");

  assertInOrder(content, ["Decision Brief", "Execution Contract", "Appendix"]);
  assert.match(content, /canonical product source/i);
  assert.match(content, /deterministically generates/i);
  assert.match(content, /RFC and Dev consume the structured scope/i);
  assert.match(content, /offline, inert, accessible, responsive, and printable/i);
});

test("groom draft step instructs authors to fill the brief and execution contract", () => {
  const content = read("skills/groom/steps/06-draft.md");

  assert.match(content, /one canonical proposal JSON/i);
  assert.match(content, /proposal-render\.js/);
  assert.match(content, /proposal-check\.js/);
  assert.match(content, /proposal-quality-check\.js/);
  assert.match(content, /generated projections/i);
});

test("RFC template puts brief and contract before appendix detail", () => {
  const content = read("references/templates/rfc-template.md");

  assertInOrder(content, [
    "## Hero Header",
    "## Decision Brief",
    "## Execution Contract",
    "## Appendix",
    "## Codebase Findings",
    "## Test Strategy",
    "## Issues",
  ]);
  assert.match(content, /Contract wins/i);
  assert.match(content, /Target <= 1,500 words/);
});

test("RFC reference HTML exposes layered anchors without breaking parser hooks", () => {
  const content = read("references/templates/rfc-reference.html");

  assertInOrder(content, ['href="#brief"', 'href="#execution-contract"', 'href="#appendix"']);
  assertInOrder(content, [
    'id="brief"',
    'id="execution-contract"',
    'id="appendix"',
    'id="codebase"',
  ]);

  for (const hook of [
    'data-schema-version="3"',
    'class="issue-detail"',
    'class="issue-detail-num"',
    'class="issue-detail-title"',
    'class="issue-detail-size"',
    "test-strategy-block",
    "hooks-badge",
  ]) {
    assert.ok(content.includes(hook), `RFC reference must preserve ${hook}`);
  }
});

test("RFC generation and review steps enforce layered artifact quality", () => {
  const generation = read("skills/rfc/steps/02-rfc-generation.md");
  const review = read("skills/rfc/steps/03-rfc-review.md");

  assert.match(generation, /Layered artifact requirements/);
  assert.match(generation, /Decision Brief/);
  assert.match(generation, /Execution Contract/);
  assert.match(generation, /Stable HTML contract/);
  assert.match(generation, /id="execution-contract"/);

  assert.match(review, /layered artifact gate/i);
  assert.match(review, /Decision Brief quality/);
  assert.match(review, /Execution Contract completeness/);
  assert.match(review, /Contract\/prose consistency/);
});

test("dev handoff prefers the execution contract and keeps legacy issue-card fallback", () => {
  const intake = read("skills/dev/steps/02-intake.md");
  const implementation = read("skills/dev/steps/05-implementation.md");
  const flow = read("skills/dev/references/implementation-flow.md");

  assert.match(intake, /Layered RFC preference/);
  assert.match(intake, /id="execution-contract"/);
  assert.match(intake, /Legacy fallback/);
  assert.match(intake, /\.issue-detail/);

  assert.match(implementation, /Read the RFC Execution Contract first/);
  assert.match(flow, /Execution Contract first/);
});
