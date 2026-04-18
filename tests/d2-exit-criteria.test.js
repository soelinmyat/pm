"use strict";

/**
 * D2 route-verification spike — exit-criteria self-check.
 *
 * Every D2 assertion test must carry a JSDoc manifest block declaring its
 * stub_boundaries, prose_reference, and additive_cost. This test mechanically
 * re-reads those manifests and adjudicates the three exit criteria from the
 * RFC:
 *
 *   (A) stub_boundaries must be a subset of the four named boundaries —
 *       {agent-dispatch, fs, git, tool-registry}. Any additional stub means
 *       the spike has outgrown its containment and the warm-up fails.
 *
 *   (B) prose_reference must cite a concrete step-file + line-range. Prose
 *       drift without a pinned line range is untrackable.
 *
 *   (C) additive_cost must document what "the next branch" of the assertion
 *       would cost. Zero (or a justified small number) keeps the spike cheap
 *       to extend.
 *
 * If Assertion #1 (dev-intake-size) passes all three gates, AC4.0 allows
 * shipping Assertion #2 (groom/01-intake tier selection). Otherwise, #2 must
 * remain unshipped (AC4.6 `test.skip`).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const TESTS_DIR = __dirname;
const STUBS_DIR = path.join(TESTS_DIR, "helpers", "stubs");

const ALLOWED_STUB_BOUNDARIES = new Set(["agent-dispatch", "fs", "git", "tool-registry"]);

/**
 * Parse the first JSDoc block in a file and extract the D2 manifest keys.
 *
 * @param {string} filePath  Absolute path to the assertion test file.
 *
 * @returns {{
 *   raw: string,
 *   adjudicated: string|null,
 *   proseReference: string|null,
 *   stubBoundaries: string[]|null,
 *   additiveCost: string|null,
 *   stepFilePath: string|null,
 *   lineRange: string|null,
 * }}
 */
function parseD2Manifest(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  // Grab the first `/** ... */` JSDoc block.
  const jsdocMatch = text.match(/\/\*\*[\s\S]*?\*\//);
  if (!jsdocMatch) {
    return {
      raw: "",
      adjudicated: null,
      proseReference: null,
      stubBoundaries: null,
      additiveCost: null,
      stepFilePath: null,
      lineRange: null,
    };
  }
  const raw = jsdocMatch[0];

  const read = (key) => {
    const re = new RegExp(`\\*\\s*${key}\\s*:\\s*(.+?)(?:\\n|$)`);
    const m = raw.match(re);
    return m ? m[1].trim() : null;
  };

  // stub_boundaries is bracketed: `[fs, git]` or `[]`.
  const boundariesLine = read("stub_boundaries");
  let stubBoundaries = null;
  if (boundariesLine !== null) {
    const bracket = boundariesLine.match(/\[(.*?)\]/);
    if (bracket) {
      stubBoundaries = bracket[1]
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }
  }

  // step-file-path / line-range live inside the `adjudicated:` line.
  const adjudicated = read("adjudicated");
  let stepFilePath = null;
  let lineRange = null;
  if (adjudicated) {
    const stepMatch = adjudicated.match(/step-file-path:\s*([^,]+?)(?:,|$)/);
    if (stepMatch) stepFilePath = stepMatch[1].trim();
    const rangeMatch = adjudicated.match(/line-range:\s*([0-9]+-[0-9]+)/);
    if (rangeMatch) lineRange = rangeMatch[1].trim();
  }

  return {
    raw,
    adjudicated,
    proseReference: read("prose_reference"),
    stubBoundaries,
    additiveCost: read("additive_cost"),
    stepFilePath,
    lineRange,
  };
}

/**
 * Audit a single assertion test against the three exit criteria. Returns a
 * list of failure messages; empty list means the assertion passed every gate.
 */
function auditManifest(manifest) {
  const failures = [];

  // (A) stub_boundaries ⊆ {agent-dispatch, fs, git, tool-registry}, |≤4|.
  if (manifest.stubBoundaries === null) {
    failures.push(
      "missing stub_boundaries — must be an array like `[fs, git]` (empty `[]` is allowed)"
    );
  } else {
    if (manifest.stubBoundaries.length > 4) {
      failures.push(
        `stub_boundaries count ${manifest.stubBoundaries.length} exceeds the D2 cap of 4`
      );
    }
    for (const boundary of manifest.stubBoundaries) {
      if (!ALLOWED_STUB_BOUNDARIES.has(boundary)) {
        failures.push(
          `stub_boundaries contains "${boundary}" which is not one of the four named boundaries {${Array.from(ALLOWED_STUB_BOUNDARIES).join(", ")}}`
        );
      }
    }
  }

  // (B) prose_reference must name a real step-file + line-range.
  if (!manifest.proseReference) {
    failures.push("missing prose_reference — must describe the quoted prose");
  }
  if (!manifest.stepFilePath) {
    failures.push(
      "adjudicated block missing `step-file-path:` — prose must be traceable to a concrete skill file"
    );
  }
  if (!manifest.lineRange) {
    failures.push("adjudicated block missing `line-range:` (expected `<start>-<end>`)");
  }

  // (C) additive_cost must be stated.
  if (!manifest.additiveCost) {
    failures.push(
      "missing additive_cost — must document the cost of the next assertion branch (e.g. `0 (reuse helper)`)"
    );
  }

  return failures;
}

test("four named stub boundaries exist under tests/helpers/stubs/", () => {
  for (const boundary of ALLOWED_STUB_BOUNDARIES) {
    const stubFile = path.join(STUBS_DIR, `${boundary}.js`);
    assert.ok(
      fs.existsSync(stubFile),
      `expected stub factory ${stubFile} to exist — the D2 spike requires all four named boundaries`
    );
  }
});

test("no additional stubs have been added under tests/helpers/stubs/", () => {
  const entries = fs.readdirSync(STUBS_DIR).filter((name) => name.endsWith(".js"));
  const disallowed = entries.filter(
    (name) => !ALLOWED_STUB_BOUNDARIES.has(name.replace(/\.js$/, ""))
  );
  assert.deepStrictEqual(
    disallowed,
    [],
    `unexpected stub files in tests/helpers/stubs/: ${disallowed.join(", ")} — the D2 spike caps boundaries at the four named ones`
  );
});

test("Assertion #1 (dev-intake-size) manifest satisfies all three exit criteria", () => {
  const manifestPath = path.join(TESTS_DIR, "d2-dev-intake-size.test.js");
  const manifest = parseD2Manifest(manifestPath);
  const failures = auditManifest(manifest);
  assert.deepStrictEqual(
    failures,
    [],
    `Assertion #1 manifest violations:\n  - ${failures.join("\n  - ")}`
  );
});

test("parseD2Manifest is byte-stable across repeated parses", () => {
  // Determinism guard: if a future refactor changes parsing, the fixture-free
  // round-trip still needs to converge on the same object shape.
  const p = path.join(TESTS_DIR, "d2-dev-intake-size.test.js");
  const a = parseD2Manifest(p);
  const b = parseD2Manifest(p);
  assert.deepStrictEqual(a, b);
});

// ---------------------------------------------------------------------------
// AC4.0 adjudication: if Assertion #2 (groom/01-intake tier selection) ships,
// it must also pass all three gates. When it does not ship, this test must
// remain skipped — not deleted — so the spike's containment remains visible.
// ---------------------------------------------------------------------------

const ASSERTION_2_PATH = path.join(TESTS_DIR, "d2-groom-intake-tier.test.js");

if (fs.existsSync(ASSERTION_2_PATH)) {
  test("Assertion #2 (groom-intake-tier) manifest satisfies all three exit criteria", () => {
    const manifest = parseD2Manifest(ASSERTION_2_PATH);
    const failures = auditManifest(manifest);
    assert.deepStrictEqual(
      failures,
      [],
      `Assertion #2 manifest violations:\n  - ${failures.join("\n  - ")}`
    );
  });
} else {
  test.skip(
    "Assertion #2 (groom-intake-tier) not shipped — AC4.6 defers until warm-up clears all three gates"
  );
}
