"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const HOOKS_PATH = path.join(__dirname, "..", "hooks", "hooks.json");

test("hooks.json is valid JSON", () => {
  const raw = fs.readFileSync(HOOKS_PATH, "utf8");
  assert.doesNotThrow(() => JSON.parse(raw));
});

test("kb-pull.sh appears in SessionStart array after reconcile-merged.sh, with async: false", () => {
  const hooks = JSON.parse(fs.readFileSync(HOOKS_PATH, "utf8"));
  const sessionStart = hooks.hooks.SessionStart;
  assert.ok(Array.isArray(sessionStart));

  // Find the first SessionStart entry (startup matcher)
  const entry = sessionStart.find((e) => e.matcher === "startup|resume|clear|compact");
  assert.ok(entry, "SessionStart entry with startup matcher must exist");

  const hooksList = entry.hooks;

  // Find reconcile-merged and kb-pull indices
  const reconcileIdx = hooksList.findIndex((h) => h.command.includes("reconcile-merged"));
  const kbPullIdx = hooksList.findIndex((h) => h.command.includes("kb-pull"));

  assert.ok(reconcileIdx >= 0, "reconcile-merged.sh must exist");
  assert.ok(kbPullIdx >= 0, "kb-pull.sh must exist in SessionStart hooks");
  assert.ok(kbPullIdx > reconcileIdx, "kb-pull.sh must come after reconcile-merged.sh");

  // Verify kb-pull is synchronous
  const kbPull = hooksList[kbPullIdx];
  assert.equal(kbPull.async, false, "kb-pull.sh must be synchronous");
  assert.equal(kbPull.type, "command");
  assert.match(kbPull.command, /kb-pull\.sh$/);
});

test("kb-push.sh appears in PostToolUse Skill array after analytics-log.sh, with async: true", () => {
  const hooks = JSON.parse(fs.readFileSync(HOOKS_PATH, "utf8"));
  const postToolUse = hooks.hooks.PostToolUse;
  assert.ok(Array.isArray(postToolUse));

  // Find the Skill matcher entry
  const skillEntry = postToolUse.find((e) => e.matcher === "Skill");
  assert.ok(skillEntry, "PostToolUse entry with Skill matcher must exist");

  const hooksList = skillEntry.hooks;

  // Find analytics-log and kb-push indices
  const analyticsIdx = hooksList.findIndex((h) => h.command.includes("analytics-log"));
  const kbPushIdx = hooksList.findIndex((h) => h.command.includes("kb-push"));

  assert.ok(analyticsIdx >= 0, "analytics-log.sh must exist");
  assert.ok(kbPushIdx >= 0, "kb-push.sh must exist in PostToolUse Skill hooks");
  assert.ok(kbPushIdx > analyticsIdx, "kb-push.sh must come after analytics-log.sh");

  // Verify kb-push is async
  const kbPush = hooksList[kbPushIdx];
  assert.equal(kbPush.async, true, "kb-push.sh must be asynchronous");
  assert.equal(kbPush.type, "command");
  assert.match(kbPush.command, /kb-push\.sh$/);
});

test("existing hook entries are unchanged", () => {
  const hooks = JSON.parse(fs.readFileSync(HOOKS_PATH, "utf8"));

  // SessionStart: check-setup, session-start, auto-launch, reconcile-merged still present
  const sessionStart = hooks.hooks.SessionStart[0];
  const sessionHookCommands = sessionStart.hooks.map((h) => h.command);

  assert.ok(
    sessionHookCommands.some((c) => c.includes("check-setup")),
    "check-setup.sh must still exist"
  );
  assert.ok(
    sessionHookCommands.some((c) => c.includes("session-start")),
    "session-start must still exist"
  );
  assert.ok(
    sessionHookCommands.some((c) => c.includes("auto-launch")),
    "auto-launch.sh must still exist"
  );
  assert.ok(
    sessionHookCommands.some((c) => c.includes("reconcile-merged")),
    "reconcile-merged.sh must still exist"
  );

  // PostToolUse Skill: analytics-log still present
  const skillEntry = hooks.hooks.PostToolUse.find((e) => e.matcher === "Skill");
  const skillHookCommands = skillEntry.hooks.map((h) => h.command);
  assert.ok(
    skillHookCommands.some((c) => c.includes("analytics-log")),
    "analytics-log.sh must still exist"
  );

  // Other PostToolUse entries unchanged
  const agentEntry = hooks.hooks.PostToolUse.find((e) => e.matcher === "Agent");
  assert.ok(agentEntry, "PostToolUse Agent matcher must still exist");

  const writeEntry = hooks.hooks.PostToolUse.find((e) => e.matcher === "Write|Edit|MultiEdit");
  assert.ok(writeEntry, "PostToolUse Write matcher must still exist");

  // PreToolUse entries unchanged
  assert.ok(hooks.hooks.PreToolUse.length >= 2, "PreToolUse entries must be unchanged");

  // SessionEnd unchanged
  assert.ok(hooks.hooks.SessionEnd.length >= 1, "SessionEnd entries must be unchanged");
});
