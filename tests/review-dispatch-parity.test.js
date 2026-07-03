"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

// ---------------------------------------------------------------------------
// Phase E4 — Codex review parallelism (parity). Short-lived read-only review
// waves (the pm:review 6-lens fan-out and groom's scope/team review waves)
// must default to parallel spawn_agent dispatch on Codex, NOT the inline-
// sequential fallback that cost ~6× wall time. Delegation stays default-off
// for mutating/implementation agents. This pins the contract the runtime reads.
// ---------------------------------------------------------------------------

test("capability-gates.md: delegation row scopes read-only review waves to parallel-by-default", () => {
  const text = read("references/capability-gates.md");
  const delegationRow = text
    .split("\n")
    .find((line) => line.includes("`delegation`") && line.includes("runtime-specific"));
  assert.ok(delegationRow, "expected the delegation gate row");
  assert.match(delegationRow, /read-only review wave/i);
  assert.match(delegationRow, /spawn_agent/);
  assert.match(delegationRow, /default/i);
  // Still default-off for mutating/implementation agents.
  assert.match(delegationRow, /mutating\/implementation/i);
});

test("capability-gates.md: usage rules carry the scoped read-only exception", () => {
  const text = read("references/capability-gates.md");
  assert.match(text, /Read-only review waves are the scoped exception/i);
  assert.match(text, /never applies to mutating\/implementation agents or subprocess dispatch/i);
});

test("agent-runtime.md: Capability Flags declares the scoped read-only review exception", () => {
  const text = read("skills/dev/references/agent-runtime.md");
  assert.match(text, /Scoped exception — short-lived read-only review waves/i);
  assert.match(text, /`pm:review` 6-lens fan-out and groom's scope\/team review waves/);
  assert.match(text, /parallel dispatch by default/i);
  // Keep default-off for mutating / lifecycle-owning work.
  assert.match(
    text,
    /Keep delegation default-off for anything that mutates files or owns a lifecycle/i
  );
  // Sequential is only the genuine-unavailability fallback.
  assert.match(
    text,
    /Inline-sequential remains the fallback only when `spawn_agent` is genuinely unavailable/
  );
});

test("agent-runtime.md: Codex delegated section defaults review waves to parallel regardless of the global flag", () => {
  const text = read("skills/dev/references/agent-runtime.md");
  assert.match(text, /Read-only review waves default here/i);
  assert.match(text, /regardless of the session's global `delegation` flag/);
});

test("review SKILL Phase 2: Codex defaults to parallel spawn_agent for the read-only wave", () => {
  const text = read("skills/review/SKILL.md");
  // The Codex bullet defaults to parallel spawn_agent regardless of the global flag.
  assert.match(text, /parallel `spawn_agent` calls for the read-only review wave/);
  assert.match(text, /regardless of the session's global `delegation` flag/);
  assert.match(text, /Sequential[\s\S]{0,120}only when `spawn_agent` is genuinely unavailable/);
  // The old flat "Codex inline / other runtimes: run the lens briefs sequentially"
  // default must be gone.
  assert.doesNotMatch(
    text,
    /\*\*Codex inline \/ other runtimes:\*\* run the lens briefs sequentially/
  );
});

test("review-gate.md dispatch row: Codex parallel spawn_agent by default, sequential only when unavailable", () => {
  const text = read("references/review-gate.md");
  const dispatchRow = text.split("\n").find((line) => line.startsWith("| Dispatch |"));
  assert.ok(dispatchRow, "expected the Dispatch parameter row");
  assert.match(dispatchRow, /Codex uses parallel `spawn_agent` for the wave by default/);
  assert.match(dispatchRow, /sequential only when `spawn_agent` is genuinely unavailable/);
  // The stale "inline-sequential fallback when delegation is unavailable" is gone.
  assert.doesNotMatch(dispatchRow, /inline-sequential fallback when delegation is unavailable/);
});
