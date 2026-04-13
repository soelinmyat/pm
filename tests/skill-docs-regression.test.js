"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const PLUGIN_ROOT = path.resolve(__dirname, "..");

function read(relPath) {
  return fs.readFileSync(path.join(PLUGIN_ROOT, relPath), "utf8");
}

test("using-pm no longer forces pm:start for direct first messages", () => {
  const text = read("skills/using-pm/SKILL.md");

  assert.match(text, /If it's a direct question or a concrete task/);
  assert.doesNotMatch(
    text,
    /\*\*If it exists\*\* — invoke `pm:start` before responding to the user/
  );
});

test("research quick references are removed from meta and think skills", () => {
  const usingPm = read("skills/using-pm/SKILL.md");
  const think = read("skills/think/SKILL.md");

  assert.doesNotMatch(usingPm, /pm:research quick/);
  assert.doesNotMatch(think, /pm:research quick/);
});

test("start skill still references workflow loading after step extraction", () => {
  const text = read("skills/start/SKILL.md");

  assert.match(text, /workflow loading, telemetry, and interaction pacing/);
  assert.match(text, /Execute the loaded workflow steps in order/);
});

test("bootstrap uses evidence/competitors as the canonical competitor location", () => {
  const text = read("skills/start/steps/02-bootstrap.md");

  assert.match(
    text,
    /mkdir -p \{pm_dir\}\/evidence\/\{competitors,research,transcripts,user-feedback\}/
  );
  assert.doesNotMatch(text, /mkdir -p \{pm_dir\}\/insights\/\{trends,competitors,business\}/);
  assert.match(text, /Competitor profiling lives under `\{pm_dir\}\/evidence\/competitors\/`/);
});

test("sync skill routes server-side status through kb-sync.js", () => {
  const text = read("skills/sync/SKILL.md");

  assert.match(text, /node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/kb-sync\.js" status/);
  assert.doesNotMatch(text, /curl -s -H "Authorization: Bearer \{token\}"/);
});
