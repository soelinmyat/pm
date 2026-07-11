"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME = fs.readFileSync(path.join(ROOT, "skills/dev/references/agent-runtime.md"), "utf8");
const DISPATCH = fs.readFileSync(path.join(ROOT, "scripts/dev-runtime/dispatch.js"), "utf8");
const SHELL = fs.readFileSync(path.join(ROOT, "scripts/dispatch-issue.sh"), "utf8");

test("CLI dispatch probes structured, streaming, permission, and resume capabilities", () => {
  assert.match(RUNTIME, /probeCapabilities/);
  assert.match(RUNTIME, /structured schema output/);
  assert.match(RUNTIME, /JSON\/stream event output/);
  assert.match(RUNTIME, /safe permission controls/);
  assert.match(RUNTIME, /Missing support blocks dispatch/);
  assert.match(DISPATCH, /probeCapabilities\(options\.runtime\)/);
});

test("structured dispatch records identity and classifies incomplete execution", () => {
  assert.match(RUNTIME, /persists the runtime session\/thread ID/);
  assert.match(RUNTIME, /missing CLI, malformed output, crash, and quota/);
  assert.match(DISPATCH, /runtime\.json/);
  assert.match(DISPATCH, /events\.jsonl/);
  assert.match(DISPATCH, /validateWorkerResult/);
});

test("safe profiles replace stale synchronous broad-permission examples", () => {
  assert.match(RUNTIME, /gpt-5\.6-sol/);
  assert.match(RUNTIME, /claude-opus-4-8/);
  assert.match(RUNTIME, /workspace-write/);
  assert.match(RUNTIME, /`auto`/);
  assert.doesNotMatch(RUNTIME, /claude -p --model opus --dangerously-skip-permissions/);
});

test("legacy shell dispatch is a compatibility shim over the Node adapter", () => {
  assert.match(SHELL, /dev-runtime\/dispatch\.js/);
  assert.doesNotMatch(SHELL, /--dangerously-skip-permissions|--full-auto/);
  assert.match(RUNTIME, /legacy-compatible shell entry point/);
});
