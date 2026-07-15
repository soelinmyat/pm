"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("public workflow docs cover every current command and isolate Simplify as compatibility", () => {
  const config = JSON.parse(read("plugin.config.json"));
  const publicDocs = `${read("README.md")}\n${read("docs/workflow-map.md")}`;
  for (const command of config.commands.filter((name) => name !== "simplify")) {
    assert.match(publicDocs, new RegExp(`/pm:${command}\\b`), `missing public command ${command}`);
  }
  const simplifyLines = publicDocs.split("\n").filter((line) => line.includes("/pm:simplify"));
  assert.ok(simplifyLines.length > 0, "Simplify compatibility redirect must be documented");
  for (const line of simplifyLines) {
    assert.match(line, /compatib|deprecated|legacy|redirect/i);
    assert.match(line, /review/i);
  }
});

test("artifact gallery binds each flagship reader to source, validation, and rendering", () => {
  const gallery = read("docs/artifact-gallery.md");
  for (const name of ["Proposal", "RFC", "Design Critique", "Review"]) {
    assert.match(gallery, new RegExp(`## ${name}\\b`));
  }
  for (const template of [
    "proposal-reference.html",
    "rfc-reference.html",
    "design-critique-report.html",
    "review-report.html",
  ]) {
    assert.match(gallery, new RegExp(template.replace(".", "\\.")));
  }
  for (const checker of [
    "proposal-check.js",
    "proposal-quality-check.js",
    "rfc-sidecar-check.js",
    "design-critique-check.js",
    "review-check.js",
    "artifact-check.js",
    "artifact-render-check.js",
  ]) {
    assert.match(gallery, new RegExp(checker.replace(".", "\\.")));
  }
  assert.match(gallery, /`pm\/`.*durable/is);
  assert.match(gallery, /`\.pm\/`.*private/is);
});

test("generated Codex installation docs explain the Simplify compatibility alias", () => {
  const install = read(".codex/INSTALL.md");
  assert.match(install, /`pm:simplify`.*compatibility.*`pm:review`/i);
});
