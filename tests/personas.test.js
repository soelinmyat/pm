"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// PM-170 Issue 3: Validate shipped persona files
// ---------------------------------------------------------------------------

const PERSONAS_DIR = path.join(__dirname, "..", "personas");

const EXPECTED_PERSONAS = [
  "adversarial-engineer",
  "designer",
  "developer",
  "product-manager",
  "staff-engineer",
  "strategist",
  "tester",
];

/**
 * Minimal frontmatter parser — extracts key: value pairs from --- delimited block.
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { data: {}, body: "" };
  const data = {};
  for (const line of match[1].split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      data[key] = value;
    }
  }
  const body = content.slice(match[0].length).trim();
  return { data, body };
}

test("PM-170: all 7 persona files exist", () => {
  for (const name of EXPECTED_PERSONAS) {
    const filePath = path.join(PERSONAS_DIR, `${name}.md`);
    assert.ok(fs.existsSync(filePath), `Missing persona file: personas/${name}.md`);
  }
});

test("PM-170: each persona has valid frontmatter with name and description", () => {
  for (const name of EXPECTED_PERSONAS) {
    const filePath = path.join(PERSONAS_DIR, `${name}.md`);
    const content = fs.readFileSync(filePath, "utf8");
    const { data } = parseFrontmatter(content);

    assert.ok(
      data.name && data.name.length > 0,
      `Persona ${name}.md must have a non-empty "name" in frontmatter`
    );
    assert.ok(
      data.description && data.description.length > 0,
      `Persona ${name}.md must have a non-empty "description" in frontmatter`
    );
  }
});

test("PM-170: each persona has a non-empty body", () => {
  for (const name of EXPECTED_PERSONAS) {
    const filePath = path.join(PERSONAS_DIR, `${name}.md`);
    const content = fs.readFileSync(filePath, "utf8");
    const { body } = parseFrontmatter(content);

    assert.ok(body.length > 0, `Persona ${name}.md must have a non-empty body after frontmatter`);
  }
});
