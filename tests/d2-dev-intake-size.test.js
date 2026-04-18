"use strict";

/**
 * D2 route-verification spike — Assertion #1 (warm-up).
 *
 * Verifies the `/pm:dev` 02-intake step still declares the canonical XS/S/M/L/XL
 * size-classification table. If this test breaks because someone renamed a size
 * bucket or dropped a row, the failure is the spike working as intended:
 * downstream skills (RFC sizing, dev routing) assume these exact labels.
 *
 * adjudicated: prose_reference VERIFIED, EM: implicit (spike-owner), PM: implicit (spike-owner), date: 2026-04-18, step-file-path: skills/dev/steps/02-intake.md, line-range: 65-71
 * prose_reference: "Classify size" decision table at skills/dev/steps/02-intake.md:65-71 (XS/S/M/L/XL rows)
 * stub_boundaries: []  (reads step file via real fs; no stubs needed — strictly within the ≤4 cap of {agent-dispatch, fs, git, tool-registry})
 * additive_cost: 0  (a second branch test — e.g. asserting "Confirm size" step ordering — can reuse the loadStepBody() helper and the same real-fs read; no new stubs required)
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const STEP_FILE = path.resolve(__dirname, "..", "skills", "dev", "steps", "02-intake.md");

/**
 * Load the step file body from real disk. Kept as a single-purpose helper so a
 * future sibling assertion (e.g. dev/04-plan ordering) can reuse the same read
 * pattern — the additive_cost claim depends on this staying trivial.
 */
function loadStepBody() {
  return fs.readFileSync(STEP_FILE, "utf8");
}

/**
 * Extract the markdown row for a given size label from the classification
 * table. We intentionally do not parse the whole table — we assert per-row so
 * a diff tells you which bucket drifted.
 */
function findSizeRow(body, sizeLabel) {
  const pattern = new RegExp(`^\\|\\s*\\*\\*${sizeLabel}\\*\\*\\s*\\|[^|]+\\|[^|]+\\|\\s*$`, "m");
  const match = body.match(pattern);
  return match ? match[0] : null;
}

test("dev/02-intake step file exists at canonical path", () => {
  assert.ok(
    fs.existsSync(STEP_FILE),
    `expected ${STEP_FILE} to exist — dev intake step was moved or deleted`
  );
});

test("dev/02-intake declares the Classify size heading", () => {
  const body = loadStepBody();
  assert.match(
    body,
    /\*\*Classify size:\*\*/,
    "expected a **Classify size:** heading — the size-decision routing depends on this step"
  );
});

test("dev/02-intake declares XS/S/M/L/XL size rows with the canonical labels", () => {
  const body = loadStepBody();
  const expectedSizes = ["XS", "S", "M", "L", "XL"];
  for (const size of expectedSizes) {
    const row = findSizeRow(body, size);
    assert.ok(
      row !== null,
      `expected a table row for size **${size}** in ${STEP_FILE} — drift will break dev routing`
    );
  }
});

test("dev/02-intake size table appears in the documented line range (65-71)", () => {
  const lines = loadStepBody().split("\n");
  // The manifest above pins line-range 65-71. We assert the table header is
  // within that window so rewrites that shift the table far from the pinned
  // range get caught by the spike instead of silently drifting.
  const headerIdx = lines.findIndex((line) =>
    /^\|\s*Size\s*\|\s*Signal\s*\|\s*Example\s*\|\s*$/.test(line)
  );
  assert.notStrictEqual(
    headerIdx,
    -1,
    "expected a `| Size | Signal | Example |` header row in dev/02-intake"
  );
  const headerLineNumber = headerIdx + 1; // 1-indexed, to match line-range semantics
  assert.ok(
    headerLineNumber >= 60 && headerLineNumber <= 80,
    `expected size table header near lines 65-71, found at line ${headerLineNumber} — update the manifest line-range if the shift is intentional`
  );
});
