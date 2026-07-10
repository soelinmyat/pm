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

test("start skill explicitly references step files after step extraction", () => {
  const text = read("skills/start/SKILL.md");

  assert.match(text, /runtime conventions/);
  assert.match(text, /Read all `\.md` files from.*skills\/start\/steps\//);
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

test("sync skill references kb-sync-git.js and does not use raw curl", () => {
  const text = read("skills/sync/SKILL.md");

  assert.match(text, /kb-sync-git\.js/);
  assert.doesNotMatch(text, /curl -s -H "Authorization: Bearer \{token\}"/);
});

test("sync skill keeps bare sync bidirectional with explicit pull and push overrides", () => {
  const skill = read("skills/sync/SKILL.md");
  const command = read("commands/sync.md");
  const parse = read("skills/sync/steps/01-parse-subcommand.md");
  const pullStep = read("skills/sync/steps/04-pull.md");
  const pushStep = read("skills/sync/steps/05-push.md");

  assert.match(skill, /Bare `\/pm:sync` is always bidirectional/);
  assert.match(command, /With no subcommand, run bidirectional sync/);
  assert.match(parse, /Route to `sync`/);
  assert.match(pullStep, /kb-sync-git\.js" sync/);
  assert.match(pushStep, /selected route is `push`/);
  assert.doesNotMatch(
    `${parse}\n${pullStep}\n${pushStep}`,
    /route is `auto`|selected route is `auto`/
  );
});

test("loop docs describe the lease envelope and isolated recovery transactions", () => {
  const config = read("skills/loop/steps/04-config.md");
  const work = read("skills/loop/steps/06-work.md");

  assert.match(config, /budgets\.lease_ttl_seconds/);
  assert.match(config, /claim-to-final-push\s+envelope/);
  assert.match(config, /scheduler overlap margin/);
  assert.match(work, /detached PM Git transaction/);
  assert.match(work, /pm\/loop\/events\/.*run_id/);
  assert.match(work, /pm\/loop\/recovery\/.*run_id/);
  assert.match(work, /never-dispatched/);
  assert.match(work, /dispatched-without-terminal-result/);
  assert.match(work, /recovery-required/);
});
