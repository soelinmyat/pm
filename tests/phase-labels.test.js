"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { phaseLabel, allPhases } = require("../scripts/phase-labels");

test("phaseLabel returns the documented label for known (kind, phase) tuples", () => {
  assert.equal(phaseLabel("groom", "scope"), "Scoping");
  assert.equal(phaseLabel("groom", "draft-proposal"), "Draft proposal");
  assert.equal(phaseLabel("rfc", "rfc-generation"), "RFC generation");
  assert.equal(phaseLabel("dev", "implement"), "Implementation");
  assert.equal(phaseLabel("dev", "ship"), "Ship");
});

test("phaseLabel returns a kind-specific label for the implicit 'active' phase", () => {
  assert.equal(phaseLabel("groom", "active"), "In progress");
  assert.equal(phaseLabel("rfc", "active"), "In progress");
  assert.equal(phaseLabel("dev", "active"), "In progress");
  assert.equal(phaseLabel("think", "active"), "Thinking");
});

test("phaseLabel distinguishes the same phase name across different kinds", () => {
  const groomActive = phaseLabel("groom", "active");
  const thinkActive = phaseLabel("think", "active");
  assert.notEqual(groomActive, thinkActive, "active should resolve differently for groom vs think");
});

test("phaseLabel falls back to title-cased phase for unknown (kind, phase) tuples", () => {
  assert.equal(phaseLabel("dev", "mystery-phase"), "Mystery phase");
  assert.equal(phaseLabel("unknown-kind", "scope"), "Scope");
  assert.equal(phaseLabel("groom", "brand-new-step"), "Brand new step");
});

test("phaseLabel returns '(no phase)' for empty or nullish phase", () => {
  assert.equal(phaseLabel("groom", ""), "(no phase)");
  assert.equal(phaseLabel("dev", null), "(no phase)");
  assert.equal(phaseLabel("rfc", undefined), "(no phase)");
});

test("allPhases exposes every documented (kind, phase, label) tuple for lint checks", () => {
  const entries = allPhases();
  assert.ok(Array.isArray(entries), "allPhases should return an array");
  assert.ok(entries.length > 0, "allPhases should not be empty");

  for (const entry of entries) {
    assert.ok(
      entry.kind && typeof entry.kind === "string",
      `entry.kind must be a non-empty string: ${JSON.stringify(entry)}`
    );
    assert.ok(
      entry.phase && typeof entry.phase === "string",
      `entry.phase must be a non-empty string: ${JSON.stringify(entry)}`
    );
    assert.ok(
      entry.label && typeof entry.label === "string",
      `entry.label must be a non-empty string: ${JSON.stringify(entry)}`
    );
  }

  const kinds = new Set(entries.map((e) => e.kind));
  for (const required of ["groom", "rfc", "dev", "think"]) {
    assert.ok(kinds.has(required), `allPhases must include kind=${required}`);
  }

  const groomPhases = new Set(entries.filter((e) => e.kind === "groom").map((e) => e.phase));
  for (const required of ["active", "intake", "scope", "design", "draft-proposal", "team-review"]) {
    assert.ok(groomPhases.has(required), `groom kind must document phase=${required}`);
  }

  const devPhases = new Set(entries.filter((e) => e.kind === "dev").map((e) => e.phase));
  for (const required of [
    "active",
    "intake",
    "workspace",
    "implement",
    "simplify",
    "review",
    "ship",
    "retro",
  ]) {
    assert.ok(devPhases.has(required), `dev kind must document phase=${required}`);
  }

  const rfcPhases = new Set(entries.filter((e) => e.kind === "rfc").map((e) => e.phase));
  for (const required of ["active", "intake", "rfc-generation", "rfc-review", "approved"]) {
    assert.ok(rfcPhases.has(required), `rfc kind must document phase=${required}`);
  }
});

test("phase-labels.md reference and JS module stay in sync", () => {
  const fs = require("fs");
  const path = require("path");
  const refPath = path.join(__dirname, "..", "references", "phase-labels.md");
  const text = fs.readFileSync(refPath, "utf8");

  const entries = allPhases();
  for (const entry of entries) {
    const row = `| \`${entry.kind}\` | \`${entry.phase}\` | ${entry.label} |`;
    assert.ok(
      text.includes(row),
      `references/phase-labels.md is missing the documented row: ${row}`
    );
  }
});
