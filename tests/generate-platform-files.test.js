"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const GENERATE_SCRIPT = path.join(__dirname, "..", "scripts", "generate-platform-files.js");

test("generated platform files are in sync with plugin.config.json", () => {
  assert.doesNotThrow(() => {
    execFileSync("node", [GENERATE_SCRIPT, "--check"], {
      cwd: path.join(__dirname, ".."),
      encoding: "utf8",
    });
  });
});

test("codex install doc uses pm-prefixed aliases for all fallback skills", () => {
  const installDoc = fs.readFileSync(path.join(__dirname, "..", ".codex", "INSTALL.md"), "utf8");

  assert.match(installDoc, /~\/\.agents\/skills\/pm-features/);
  assert.match(installDoc, /~\/\.agents\/skills\/pm-dev/);
  assert.match(installDoc, /~\/\.agents\/skills\/pm-ship/);
  assert.match(installDoc, /~\/\.agents\/skills\/pm-using-pm/);
  assert.doesNotMatch(installDoc, /~\/\.agents\/skills\/dev-dev/);
  assert.doesNotMatch(installDoc, /~\/\.agents\/skills\/dev-ship/);
  assert.doesNotMatch(installDoc, /~\/\.agents\/skills\/dev-using-pm/);
});
