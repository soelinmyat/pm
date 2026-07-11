"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

test("RFC skill uses phase-local JSON state and keeps review distinct from approval", () => {
  const skill = read("skills/rfc/SKILL.md");
  assert.match(skill, /rfc-session\.js next/);
  assert.match(skill, /session\.json/);
  assert.match(skill, /awaiting_approval/);
  assert.doesNotMatch(skill, /Read all .*steps/);
  assert.match(skill, /NEVER MARK AN RFC APPROVED WITHOUT EXPLICIT HUMAN APPROVAL/);
});

test("review step cannot write approved lifecycle state", () => {
  const review = read("skills/rfc/steps/03-rfc-review.md");
  assert.match(review, /reviewed.*awaiting approval/i);
  assert.doesNotMatch(review, /Update RFC frontmatter to `status: approved`/);
  assert.doesNotMatch(review, /Update the proposal status to `planned`/);
});

test("approval and external handoff live in a separate final step", () => {
  const approval = read("skills/rfc/steps/04-approval.md");
  const handoff = read("skills/rfc/steps/05-handoff.md");
  assert.match(approval, /rfc-session\.js approve/);
  assert.match(approval, /artifact (hash|fingerprint)/i);
  assert.doesNotMatch(approval, /linear-operations\.md/);
  assert.match(handoff, /authority/);
  assert.match(handoff, /Linear/);
  assert.match(handoff, /loop/);
});

test("model policy is data, not duplicated provider coaching", () => {
  const profiles = JSON.parse(read("skills/rfc/references/model-profiles.json"));
  assert.equal(profiles.profiles[profiles.defaults.codex].model, "gpt-5.6-sol");
  assert.equal(profiles.profiles[profiles.defaults.codex].effort, "high");
  assert.equal(profiles.profiles[profiles.defaults.claude].model, "claude-opus-4-8");
  assert.equal(profiles.profiles[profiles.defaults.claude].effort, "xhigh");
  for (const step of ["02-rfc-generation.md", "03-rfc-review.md"]) {
    assert.doesNotMatch(read(`skills/rfc/steps/${step}`), /gpt-5\.6|claude-opus-4-8/i);
  }
});
