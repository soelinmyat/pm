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
