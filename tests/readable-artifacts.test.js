"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { renderProposal } = require("../scripts/proposal-render");
const root = path.resolve(__dirname, "..");
const fixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures/proposals/strong-v1.json"))
);

test("proposal reader has nested navigation outside disclosures and a single recommendation", () => {
  const { html } = renderProposal(fixture);
  const nav = html.match(/<nav[^>]*aria-label="Proposal sections"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
  assert.ok(nav);
  assert.match(nav, /<ul[^>]*>[\s\S]*<li>[\s\S]*<ul/);
  assert.ok(html.indexOf("<nav") < html.indexOf('<details class="appendix-disclosure"'));
  assert.doesNotMatch(html, /<details class="appendix-disclosure" open/);
  assert.equal(html.split(fixture.decision_brief.recommendation).length - 1, 1);
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  for (const [, id] of nav.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.has(id), id);
  for (const row of fixture.acceptance_criteria) assert.ok(html.includes(row.then));
  assert.ok(html.indexOf('id="open-q"') < html.indexOf('<details class="appendix-disclosure"'));
});

test("proposal prototype is discoverable early without inventing previews or approvals", () => {
  const { html } = renderProposal(fixture);
  assert.match(html, /id="mockups"/);
  assert.ok(html.indexOf('id="decision-brief"') < html.indexOf('id="mockups"'));
  assert.ok(html.indexOf('id="mockups"') < html.indexOf('id="execution-contract"'));
  assert.doesNotMatch(html, /<iframe|<object|<embed|<script(?![^>]*application\/json)/i);
  const none = structuredClone(fixture);
  none.design_context.prototype = null;
  assert.match(renderProposal(none).html, /No prototype is linked/);
});

test("RFC reference has two-level navigation to real headings and preserves execution hooks", () => {
  const html = fs.readFileSync(path.join(root, "references/templates/rfc-reference.html"), "utf8");
  const nav = html.match(/<nav[\s\S]*?<\/nav>/)[0];
  assert.match(nav, /<ul[^>]*>[\s\S]*<li>[\s\S]*<ul/);
  for (const [, id] of nav.matchAll(/href="#([^"]+)"/g)) assert.ok(html.includes(`id="${id}"`), id);
  assert.match(html, /<details class="execution-disclosure">/);
  for (const hook of [
    'id="brief"',
    'id="execution-contract"',
    'id="appendix"',
    'id="test-strategy"',
    'class="issue-detail"',
    'data-schema-version="3"',
  ])
    assert.ok(html.includes(hook), hook);
});

test("disclosed contracts remain printable in current Chromium", () => {
  for (const name of ["proposal", "rfc"]) {
    const html = fs.readFileSync(
      path.join(root, `references/templates/${name}-reference.html`),
      "utf8"
    );
    assert.match(
      html,
      /@media print\s*\{\s*details::details-content\s*\{[^}]*content-visibility:\s*visible!important/
    );
  }
});
