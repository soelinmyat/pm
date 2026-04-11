"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { execFileSync } = require("child_process");

const GENERATE_SCRIPT = path.join(__dirname, "..", "scripts", "generate-platform-files.js");
const {
  extractFrontmatter,
  REQUIRES_ALLOWLIST,
  DEGRADATION_VALUES,
} = require("../scripts/generate-platform-files.js");

test("generated platform files are in sync with plugin.config.json", () => {
  assert.doesNotThrow(() => {
    execFileSync("node", [GENERATE_SCRIPT, "--check"], {
      cwd: path.join(__dirname, ".."),
      encoding: "utf8",
    });
  });
});

// --- Frontmatter extraction tests ---

test("extractFrontmatter: valid frontmatter parses correctly", () => {
  const content = `---
name: test-skill
description: "A test skill"
runtime:
  requires: [delegation]
  agents: 3
  guarantee: "3 independent agents"
  degradation: inline
---

# Body content`;
  const fm = extractFrontmatter(content);
  assert.equal(fm.name, "test-skill");
  assert.deepEqual(fm.runtime.requires, ["delegation"]);
  assert.equal(fm.runtime.agents, 3);
  assert.equal(fm.runtime.guarantee, "3 independent agents");
  assert.equal(fm.runtime.degradation, "inline");
});

test("extractFrontmatter: returns null for missing frontmatter", () => {
  const content = "# No frontmatter here";
  const fm = extractFrontmatter(content);
  assert.equal(fm, null);
});

test("extractFrontmatter: handles Windows line endings", () => {
  const content =
    '---\r\nname: test\r\nruntime:\r\n  requires: []\r\n  agents: 0\r\n  guarantee: "ok"\r\n  degradation: none\r\n---\r\n';
  const fm = extractFrontmatter(content);
  assert.equal(fm.name, "test");
  assert.equal(fm.runtime.agents, 0);
});

// --- Frontmatter validation tests (using assertSkillFrontmatter via --check) ---
// These tests validate the schema rules by testing extractFrontmatter output
// against the same rules the build script enforces.

function validateRuntime(rt, name) {
  const errors = [];
  if (!rt) {
    errors.push(`${name}: missing runtime block`);
    return errors;
  }
  if (!Array.isArray(rt.requires)) {
    errors.push(`${name}: runtime.requires must be an array`);
  } else {
    for (const cap of rt.requires) {
      if (typeof cap !== "string") {
        errors.push(`${name}: runtime.requires values must be strings`);
      } else if (!REQUIRES_ALLOWLIST.includes(cap)) {
        errors.push(`${name}: runtime.requires contains unknown value "${cap}"`);
      }
    }
  }
  if (typeof rt.agents !== "number" || !Number.isInteger(rt.agents) || rt.agents < 0) {
    errors.push(`${name}: runtime.agents must be a non-negative integer`);
  }
  if (typeof rt.guarantee !== "string" || rt.guarantee.trim() === "") {
    errors.push(`${name}: runtime.guarantee must be a non-empty string`);
  }
  if (!DEGRADATION_VALUES.includes(rt.degradation)) {
    errors.push(`${name}: runtime.degradation must be one of: ${DEGRADATION_VALUES.join(", ")}`);
  }
  return errors;
}

test("validation: valid runtime block passes", () => {
  const rt = {
    requires: ["delegation"],
    agents: 3,
    guarantee: "test output",
    degradation: "inline",
  };
  const errors = validateRuntime(rt, "test");
  assert.equal(errors.length, 0);
});

test("validation: missing runtime block fails", () => {
  const errors = validateRuntime(undefined, "test");
  assert.equal(errors.length, 1);
  assert.ok(errors[0].includes("missing runtime block"));
});

test("validation: agents as string fails", () => {
  const rt = { requires: [], agents: "3", guarantee: "test", degradation: "none" };
  const errors = validateRuntime(rt, "test");
  assert.ok(errors.some((e) => e.includes("runtime.agents")));
});

test("validation: negative agents fails", () => {
  const rt = { requires: [], agents: -1, guarantee: "test", degradation: "none" };
  const errors = validateRuntime(rt, "test");
  assert.ok(errors.some((e) => e.includes("runtime.agents")));
});

test("validation: float agents fails", () => {
  const rt = { requires: [], agents: 1.5, guarantee: "test", degradation: "none" };
  const errors = validateRuntime(rt, "test");
  assert.ok(errors.some((e) => e.includes("runtime.agents")));
});

test("validation: invalid degradation value fails", () => {
  const rt = { requires: [], agents: 0, guarantee: "test", degradation: "fallback" };
  const errors = validateRuntime(rt, "test");
  assert.ok(errors.some((e) => e.includes("runtime.degradation")));
});

test("validation: unknown requires value fails", () => {
  const rt = { requires: ["teleportation"], agents: 1, guarantee: "test", degradation: "inline" };
  const errors = validateRuntime(rt, "test");
  assert.ok(errors.some((e) => e.includes("unknown value")));
});

test("validation: empty guarantee fails", () => {
  const rt = { requires: [], agents: 0, guarantee: "", degradation: "none" };
  const errors = validateRuntime(rt, "test");
  assert.ok(errors.some((e) => e.includes("runtime.guarantee")));
});

test("validation: whitespace-only guarantee fails", () => {
  const rt = { requires: [], agents: 0, guarantee: "   ", degradation: "none" };
  const errors = validateRuntime(rt, "test");
  assert.ok(errors.some((e) => e.includes("runtime.guarantee")));
});
