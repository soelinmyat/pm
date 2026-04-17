"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const SKILL_DIR = path.join(__dirname, "..", "skills", "list");
const SKILL_MD = path.join(SKILL_DIR, "SKILL.md");
const STEP_01 = path.join(SKILL_DIR, "steps", "01-discover.md");
const STEP_02 = path.join(SKILL_DIR, "steps", "02-render.md");

function read(file) {
  return fs.readFileSync(file, "utf8");
}

test("skills/list/SKILL.md exists with required frontmatter", () => {
  const text = read(SKILL_MD);
  assert.match(text, /^---\nname: list\n/, "frontmatter missing or name not 'list'");
  assert.match(text, /^description: /m, "frontmatter missing description");
});

test("SKILL.md declares iron law and workflow/telemetry", () => {
  const text = read(SKILL_MD);
  assert.match(text, /## Iron Law/);
  assert.match(text, /LIST IS READ-ONLY/i, "iron law must forbid writes");
  assert.match(text, /Workflow:.*`list`/);
  assert.match(text, /discover.*render|render.*discover/is);
});

test("SKILL.md preserves per-skill resume (not replacement)", () => {
  const text = read(SKILL_MD);
  assert.match(text, /per-skill resume/i);
  assert.match(text, /preserved/i);
});

test("SKILL.md covers red flags and escalation paths", () => {
  const text = read(SKILL_MD);
  assert.match(text, /## Red Flags/i);
  assert.match(text, /## Escalation Paths/i);
});

test("step 01 (discover) invokes the list-rows emitter", () => {
  const text = read(STEP_01);
  assert.match(text, /--format list-rows/);
  assert.match(text, /scripts\/start-status\.js/);
  assert.match(text, /\$\{CLAUDE_PLUGIN_ROOT\}/, "must use plugin-root path resolver");
});

test("step 01 documents ListRowsPayload shape (four sections + meta)", () => {
  const text = read(STEP_01);
  for (const field of ["active", "proposals", "rfcs", "shipped", "meta"]) {
    assert.match(text, new RegExp(`"${field}"`), `missing payload field: ${field}`);
  }
});

test("step 01 copies the session-path table from skills/start/steps/03-resume.md", () => {
  const text = read(STEP_01);
  assert.match(text, /\{source_dir\}\/\.pm\/groom-sessions/);
  assert.match(text, /\{source_dir\}\/\.pm\/rfc-sessions/);
  assert.match(text, /\{source_dir\}\/\.pm\/dev-sessions/);
  assert.match(text, /\{source_dir\}\/\.pm\/think-sessions/);
});

test("step 01 handles empty-payload with a single-line fallback", () => {
  const text = read(STEP_01);
  assert.match(text, /No in-flight work found/);
  assert.match(text, /\/pm:start/);
});

test("step 02 (render) enumerates exactly the five documented intents by name", () => {
  const text = read(STEP_02);
  const intents = [
    "expand-section",
    "filter-to-section",
    "emit-json",
    "expand-row-detail",
    "show-staleness",
  ];
  for (const intent of intents) {
    assert.match(text, new RegExp(intent), `missing intent name: ${intent}`);
  }
});

test("step 02 has at least one example phrasing per intent", () => {
  const text = read(STEP_02);
  assert.match(text, /"show all proposals"|show all proposals/);
  assert.match(text, /"just the RFCs"|only active sessions/);
  assert.match(text, /"give me the raw JSON"|emit JSON/i);
  assert.match(text, /"what's PM-45 about\?"|details on/i);
  assert.match(text, /"what's stale\?"|needs attention/i);
});

test("step 02 documents the row format spec (all required fields)", () => {
  const text = read(STEP_02);
  for (const field of [
    "shortId",
    "topic",
    "phaseLabel",
    "ageRelative",
    "staleness",
    "resumeHint",
    "linkage",
  ]) {
    assert.match(text, new RegExp(field), `row format missing field: ${field}`);
  }
});

test("step 02 documents the four staleness tiers", () => {
  const text = read(STEP_02);
  for (const tier of ["fresh", "default", "stale", "cold"]) {
    assert.match(text, new RegExp(`\\b${tier}\\b`), `missing staleness tier: ${tier}`);
  }
});

test("step 02 defines the fall-through escalation template", () => {
  const text = read(STEP_02);
  assert.match(text, /fall.?through|escalation/i);
  assert.match(text, /not sure how to map/i, "must include the escalation template sentence");
  assert.match(
    text,
    /\/pm:groom resume|\/pm:dev resume/,
    "must point at per-skill resume commands"
  );
});

test("step 02 references the committed JSON fixture set", () => {
  const text = read(STEP_02);
  assert.match(text, /tests\/fixtures\/list-rows/);
  // All six canonical fixtures named.
  for (const name of [
    "empty-repo",
    "single-section",
    "all-sections",
    "over-cap",
    "separate-repo",
    "missing-frontmatter",
  ]) {
    assert.match(text, new RegExp(name), `step 02 must name fixture: ${name}`);
  }
});

test("step 02 specifies linkage-arrow rendering per row.linkage state", () => {
  const text = read(STEP_02);
  // Arrow variants
  assert.match(text, /→ rfc ready/);
  assert.match(text, /→ \/pm:dev/);
  // Negative: when linkage is null, arrow is omitted
  assert.match(text, /omit the arrow|linkage is null/i);
});

test("step 02 documents per-row resume-hint per kind", () => {
  const text = read(STEP_02);
  assert.match(text, /\/pm:groom resume/);
  assert.match(text, /\/pm:rfc resume/);
  assert.match(text, /\/pm:dev resume/);
  assert.match(text, /\/pm:think resume/);
  // Backlog kinds
  assert.match(text, /\/pm:rfc <shortId>/);
  assert.match(text, /\/pm:dev <shortId>/);
});

test("step 02 specifies telemetry log path for fall-through cases", () => {
  const text = read(STEP_02);
  assert.match(text, /\.pm\/\.list-telemetry\.jsonl/);
});

test("skills/list files end with a trailing newline (format discipline)", () => {
  for (const file of [SKILL_MD, STEP_01, STEP_02]) {
    const text = read(file);
    assert.ok(text.endsWith("\n"), `${path.relative(process.cwd(), file)} must end with \\n`);
  }
});
