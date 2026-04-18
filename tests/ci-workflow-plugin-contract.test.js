"use strict";

// Assert the GitHub Actions workflow wires the plugin-contract job correctly.
//
// We intentionally do NOT parse ci.yml as YAML — adding js-yaml for a single
// test is disproportionate (Int-adv-1 advisory). Regex + indexOf on the raw
// text is sufficient to detect drift (e.g. a rename of the job or command).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const WORKFLOW_PATH = path.resolve(__dirname, "..", ".github", "workflows", "ci.yml");

test("ci.yml exists at the canonical path", () => {
  assert.ok(fs.existsSync(WORKFLOW_PATH), ".github/workflows/ci.yml must exist");
});

test("ci.yml declares a `plugin-contract:` job", () => {
  const text = fs.readFileSync(WORKFLOW_PATH, "utf8");
  assert.match(text, /^\s*plugin-contract:\s*$/m);
});

test("ci.yml invokes `node scripts/validate.js --plugin`", () => {
  const text = fs.readFileSync(WORKFLOW_PATH, "utf8");
  assert.ok(
    text.includes("node scripts/validate.js --plugin"),
    "plugin-contract job must call `node scripts/validate.js --plugin`"
  );
});

test("ci.yml triggers on both pull_request and push (top-level `on:`)", () => {
  const text = fs.readFileSync(WORKFLOW_PATH, "utf8");
  assert.match(text, /^\s*pull_request:\s*$/m);
  assert.match(text, /^\s*push:\s*$/m);
});
