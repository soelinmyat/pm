"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const FILES = [
  "README.md",
  ".codex/INSTALL.md",
  "commands/dev.md",
  "commands/review.md",
  "commands/ship.md",
];

test("public delivery surfaces make the same zero-edit safe-routing promise", () => {
  for (const relative of FILES) {
    const text = fs.readFileSync(path.join(ROOT, relative), "utf8");
    assert.match(text, /zero consumer edits/i, relative);
    assert.match(text, /automatically discovers?/i, relative);
    assert.match(text, /comprehensive/i, relative);
    assert.match(
      text,
      /explicit(?:ly)?\s+authorized\s+machine-readable\s+candidate-publication\s+policy/i,
      relative
    );
    assert.match(text, /PM_DELIVERY_COMPREHENSIVE=1/, relative);
  }
});

test("telemetry documentation names bounded private fields and exclusions", () => {
  const text = fs.readFileSync(path.join(ROOT, "references/telemetry.md"), "utf8");
  for (const phrase of [
    "environment-preflight",
    "active-command",
    "review-wait",
    "ci-queue",
    "ci-run",
    "merge-wait",
    "invalidation",
    "reuse",
    "final-certification",
    "512 events",
    "1 MiB",
    "0600",
  ])
    assert.match(text, new RegExp(phrase, "i"), phrase);
  assert.match(text, /never records?.*command output/i);
});
