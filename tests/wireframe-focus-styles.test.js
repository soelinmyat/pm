"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Regression test: wireframe-base.css interactive primitives must expose a
// visible keyboard focus indicator. Design critique on generated wireframes
// flagged .wf-input/.wf-button/.wf-button-secondary as missing :focus-visible
// styling, which is a WCAG 2.4.7 gap in every prototype rendered from this
// template. This test pins the fix so it can't silently regress.
// ---------------------------------------------------------------------------

const CSS_PATH = path.resolve(__dirname, "../references/templates/wireframe-base.css");

test("wireframe-base.css: .wf-input has a visible :focus-visible style", () => {
  const css = fs.readFileSync(CSS_PATH, "utf8");
  assert.match(css, /\.wf-input:focus-visible\s*\{[^}]*outline/);
});

test("wireframe-base.css: .wf-button has a visible :focus-visible style", () => {
  const css = fs.readFileSync(CSS_PATH, "utf8");
  assert.match(css, /\.wf-button:focus-visible[\s\S]{0,80}\{[^}]*outline/);
});

test("wireframe-base.css: .wf-button-secondary has a visible :focus-visible style", () => {
  const css = fs.readFileSync(CSS_PATH, "utf8");
  assert.match(css, /\.wf-button-secondary:focus-visible[\s\S]{0,80}\{[^}]*outline/);
});

test("wireframe-base.css: focus ring uses a dedicated token, not the loading-state color", () => {
  const css = fs.readFileSync(CSS_PATH, "utf8");
  assert.match(css, /--wf-focus:\s*#[0-9a-fA-F]{3,6}/, "expected a dedicated --wf-focus token");
  const focusRules =
    css.match(
      /\.wf-(?:input|button(?:-secondary)?)(?:,[\s\S]{0,80})?:focus-visible[\s\S]{0,120}?\{[^}]*\}/g
    ) || [];
  assert.ok(focusRules.length > 0, "expected at least one :focus-visible rule");
  for (const rule of focusRules) {
    assert.doesNotMatch(
      rule,
      /--wf-state-load/,
      `focus rule should not reuse the loading-state token: ${rule}`
    );
  }
});

test("wireframe-base.css: .wf-input and .wf-button share the same focus outline-offset", () => {
  const css = fs.readFileSync(CSS_PATH, "utf8");
  const inputOffset = css.match(/\.wf-input:focus-visible\s*\{[^}]*outline-offset:\s*([^;]+);/);
  const buttonOffset = css.match(
    /\.wf-button:focus-visible[\s\S]{0,80}\{[^}]*outline-offset:\s*([^;]+);/
  );
  assert.ok(
    inputOffset && buttonOffset,
    "expected outline-offset on both .wf-input and .wf-button focus rules"
  );
  assert.equal(inputOffset[1].trim(), buttonOffset[1].trim());
});
