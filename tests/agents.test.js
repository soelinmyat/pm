"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const AGENTS_DIR = path.join(__dirname, "..", "agents");

const EXPECTED_AGENTS = [
  "adversarial-engineer",
  "designer",
  "developer",
  "product-manager",
  "staff-engineer",
  "strategist",
  "tester",
];

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

test("agents: all 7 plugin agent files exist", () => {
  for (const name of EXPECTED_AGENTS) {
    const filePath = path.join(AGENTS_DIR, `${name}.md`);
    assert.ok(fs.existsSync(filePath), `Missing agent file: agents/${name}.md`);
  }
});

test("agents: each agent has name and description in frontmatter", () => {
  for (const name of EXPECTED_AGENTS) {
    const filePath = path.join(AGENTS_DIR, `${name}.md`);
    const { data } = parseFrontmatter(fs.readFileSync(filePath, "utf8"));
    assert.ok(data.name && data.name.length > 0, `agents/${name}.md needs "name"`);
    assert.ok(
      data.description && data.description.length > 0,
      `agents/${name}.md needs "description"`
    );
  }
});

test("agents: each agent name matches its filename slug (lowercase)", () => {
  for (const name of EXPECTED_AGENTS) {
    const filePath = path.join(AGENTS_DIR, `${name}.md`);
    const { data } = parseFrontmatter(fs.readFileSync(filePath, "utf8"));
    assert.equal(
      data.name,
      name,
      `agents/${name}.md frontmatter "name" must equal "${name}" (got "${data.name}"). Plugin agents register as pm:<name> using this slug.`
    );
  }
});

test("agents: each agent has a non-empty body", () => {
  for (const name of EXPECTED_AGENTS) {
    const filePath = path.join(AGENTS_DIR, `${name}.md`);
    const { body } = parseFrontmatter(fs.readFileSync(filePath, "utf8"));
    assert.ok(body.length > 0, `agents/${name}.md body must not be empty`);
  }
});
