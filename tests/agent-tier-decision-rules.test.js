"use strict";

// PM-233 Issue 6: brief exchange decision rule + Iron Law gate
//
// These tests validate that the agent-tier step files contain the structural
// decision rules that the orchestrator depends on. We're testing markdown
// content (skill-as-instruction) — heavy unit tests of LLM behavior live in
// dogfood retros, not CI. The smoke-check disclosure in the RFC is honest
// about what CI does and does not cover.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const PLUGIN_ROOT = path.resolve(__dirname, "..");

function readStep(file) {
  return fs.readFileSync(path.join(PLUGIN_ROOT, "skills/groom/steps", file), "utf8");
}

function readReference(file) {
  return fs.readFileSync(path.join(PLUGIN_ROOT, "skills/groom/references", file), "utf8");
}

// ---------------------------------------------------------------------------
// Brief exchange decision rule (lives in 01a-intake-agent.md Phase D)
// ---------------------------------------------------------------------------

test("agent tier: 01a intake declares Q1 trigger (KB anchor check)", () => {
  const body = readStep("01a-intake-agent.md");

  // Q1 fires when topic slug has no anchor in thinking/, backlog/, or
  // research index. If this prose disappears, the brief-exchange logic
  // silently broadens to "ask whenever".
  assert.ok(
    /Q1[^\n]*KB anchor/i.test(body),
    "01a-intake-agent.md must label Q1 as the 'KB anchor check'"
  );
  assert.ok(
    body.includes("pm/thinking") || body.includes("`{pm_dir}/thinking"),
    "Q1 trigger must reference the thinking/ scan"
  );
  assert.ok(
    body.includes("pm/backlog") || body.includes("`{pm_dir}/backlog"),
    "Q1 trigger must reference the backlog/ scan"
  );
  assert.ok(
    body.includes("evidence/research/index.md"),
    "Q1 trigger must reference the research index scan"
  );
});

test("agent tier: 01a intake declares Q2 ambiguity check (deferred to 04a)", () => {
  const body = readStep("01a-intake-agent.md");

  // Q2 is described in 01a as a state-field setup but the actual ask
  // happens from 04a after synthesizer dispatch. The two-signal rule
  // must be mechanical (both true → ask; either false → skip).
  assert.ok(
    body.includes("candidate_jtbds >= 2"),
    "01a must document the candidate_jtbds threshold"
  );
  assert.ok(
    body.includes("no_clear_primary == true") || body.includes("no_clear_primary"),
    "01a must document the no_clear_primary flag"
  );
  assert.ok(
    body.toLowerCase().includes("if both true") || body.toLowerCase().includes("if both signals"),
    "01a Q2 trigger must be mechanical (both signals required)"
  );
});

test("agent tier: 01a intake hard-caps questions at 2", () => {
  const body = readStep("01a-intake-agent.md");

  assert.ok(
    /never more than 2 questions/i.test(body),
    "01a must declare a hard cap of 2 questions"
  );
  assert.ok(
    body.includes("questions_asked > 2"),
    "01a must reference the telemetry alert when questions_asked exceeds 2"
  );
});

// ---------------------------------------------------------------------------
// Iron Law gate (lives in 04a-synthesis.md Phase B)
// ---------------------------------------------------------------------------

test("agent tier: 04a synthesis runs orchestrator-side fs.exists on cited paths", () => {
  const body = readStep("04a-synthesis.md");

  // The whole point of the orchestrator-side check is that the synthesizer's
  // self-report (research_cited: true) is not enough. The orchestrator must
  // independently verify every cited research path exists on disk.
  assert.ok(body.includes("fs.exists"), "04a must invoke fs.exists on cited paths");
  assert.ok(
    body.includes("missing_paths"),
    "04a must populate missing_paths for cited paths that fail fs.exists"
  );
  assert.ok(/halt/i.test(body) && /iron law/i.test(body), "04a must halt on Iron Law gate failure");
  assert.ok(body.includes("/pm:research"), "04a halt directive must point at /pm:research");
});

test("agent tier: 04a synthesis sets fs_exists_checked: true after the check", () => {
  const body = readStep("04a-synthesis.md");

  // The synthesizer is forbidden from setting fs_exists_checked itself
  // (per synthesizer-agent.md). The 04a step body owns this flag.
  assert.ok(
    body.includes("fs_exists_checked: true") || body.includes("fs_exists_checked:`"),
    "04a must set fs_exists_checked: true after running the check"
  );
});

test("agent tier: synthesizer-agent.md forbids self-reporting fs_exists_checked", () => {
  const body = readReference("synthesizer-agent.md");

  // Defends the anti-collusion property: the synthesizer agent cannot
  // claim it ran a check it didn't actually run. The 04a step body
  // is the authoritative validator.
  assert.ok(
    /DO NOT set `fs_exists_checked: true` from the synthesizer side/i.test(body),
    "synthesizer-agent.md must explicitly forbid self-reporting fs_exists_checked"
  );
});

// ---------------------------------------------------------------------------
// Q2 re-dispatch is scoped (cost-saving)
// ---------------------------------------------------------------------------

test("agent tier: Q2 re-dispatch scoped to @persona-jtbd-deriver only", () => {
  const body04a = readStep("04a-synthesis.md");
  const bodySyn = readReference("synthesizer-agent.md");

  // Per RFC §5.1: re-dispatch is scoped — only @persona-jtbd-deriver
  // re-fires on Q2. @scope-deriver and @risk-identifier outputs reused.
  // Cost: 1× sub-persona vs 3×.
  assert.ok(
    /scope[d]?/i.test(body04a) && body04a.includes("@persona-jtbd-deriver"),
    "04a must scope Q2 re-dispatch to @persona-jtbd-deriver only"
  );
  assert.ok(
    body04a.includes("@scope-deriver") && /reuse/i.test(body04a),
    "04a must document that @scope-deriver output is reused (not re-dispatched)"
  );
  assert.ok(
    bodySyn.includes("@persona-jtbd-deriver") && /scoped/i.test(bodySyn),
    "synthesizer-agent.md must mirror the scoped re-dispatch rule"
  );
});

// ---------------------------------------------------------------------------
// Tier gate (KB freshness) — guards the entire agent path
// ---------------------------------------------------------------------------

test("agent tier: 01a intake refuses on stale strategy, thin insights, or thin competitors", () => {
  const body = readStep("01a-intake-agent.md");

  // The freshness gate has three thresholds; the prose must enumerate
  // each so the LLM can refuse with the right directive.
  assert.ok(
    body.includes("90 day") || body.includes("< 90"),
    "01a must declare the 90-day strategy freshness threshold"
  );
  assert.ok(
    body.includes(">= 3") || body.includes("≥ 3"),
    "01a must declare the >=3 hot insights threshold"
  );
  assert.ok(
    body.includes(">= 2") || body.includes("≥ 2"),
    "01a must declare the >=2 competitor profiles threshold"
  );
  assert.ok(/refuse/i.test(body), "01a must explicitly refuse on gate failure");
});

test("agent tier: 01a intake refuses agent tier under codex runtime", () => {
  const body = readStep("01a-intake-agent.md");

  assert.ok(
    body.includes("Codex") && /refuse/i.test(body),
    "01a must refuse codex runtime explicitly"
  );
  assert.ok(
    body.includes("--tier standard"),
    "01a refusal directive must point users at --tier standard"
  );
});
