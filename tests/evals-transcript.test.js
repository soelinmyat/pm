"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const {
  parseJsonl,
  normalizeEvents,
  checkTranscript,
  parseCheckFrames,
  escapeFrameLines,
  FRAME_PREFIX,
} = require("../scripts/evals/transcript.js");

const repoRoot = path.resolve(__dirname, "..");
const preludePath = path.join(repoRoot, "scripts", "evals", "prelude.sh");

test("transcript helpers match skills, tools, and ordering", () => {
  const events = normalizeEvents([
    { type: "skill", name: "pm:dev" },
    { type: "tool", name: "functions.exec_command" },
    { type: "skill", name: "pm:review" },
  ]);

  assert.equal(checkTranscript(events, "skill-called", "pm:dev").status, "pass");
  assert.equal(checkTranscript(events, "tool-called", "functions.exec_command").status, "pass");
  assert.equal(
    checkTranscript(events, "skill-before-tool", "pm:dev", "functions.exec_command").status,
    "pass"
  );
  assert.equal(
    checkTranscript(events, "no-tool-before-skill", "functions.exec_command", "pm:dev").status,
    "pass"
  );
});

test("transcript helpers fail deterministically for missing observed behavior", () => {
  const events = normalizeEvents([{ type: "skill", name: "pm:groom" }]);
  const result = checkTranscript(events, "skill-called", "pm:dev");
  assert.equal(result.status, "fail");
  assert.match(result.reason, /skill not called/);
});

test("missing or malformed transcript data is indeterminate", () => {
  assert.equal(checkTranscript([], "skill-called", "pm:dev").status, "indeterminate");
  assert.equal(parseJsonl("{bad json").status, "indeterminate");
});

test("tool selectors match logical classes and command content", () => {
  const events = normalizeEvents([
    { type: "skill", name: "pm:dev" },
    { type: "tool", name: "functions.exec_command", command: "npm test", exit_code: 0 },
    { type: "skill", name: "pm:review" },
    { type: "tool", name: "Bash", command: "git push origin main", exit_code: 0 },
  ]);

  assert.equal(checkTranscript(events, "tool-called", "run-command").status, "pass");
  assert.equal(checkTranscript(events, "tool-called", "run-command~git push").status, "pass");
  assert.equal(checkTranscript(events, "tool-not-called", "run-command~rm -rf").status, "pass");
  assert.equal(checkTranscript(events, "tool-not-called", "run-command~git push").status, "fail");
  assert.equal(
    checkTranscript(events, "no-tool-before-skill", "run-command~git push", "pm:review").status,
    "pass"
  );
});

test("no-tool-before-skill fails when the anchored tool precedes the skill", () => {
  const events = normalizeEvents([
    { type: "skill", name: "pm:dev" },
    { type: "tool", name: "functions.exec_command", command: "git push origin main", exit_code: 0 },
    { type: "skill", name: "pm:review" },
  ]);

  const result = checkTranscript(
    events,
    "no-tool-before-skill",
    "run-command~git push",
    "pm:review"
  );
  assert.equal(result.status, "fail");
});

test("test-red-green requires observed fail, edit, then pass", () => {
  const good = normalizeEvents([
    { type: "skill", name: "pm:dev" },
    { type: "tool", name: "functions.exec_command", command: "npm test", exit_code: 1 },
    { type: "tool", name: "functions.apply_patch", command: "apply_patch src/x.js" },
    { type: "tool", name: "functions.exec_command", command: "npm test", exit_code: 0 },
  ]);
  assert.equal(checkTranscript(good, "test-red-green", "test").status, "pass");

  const neverRed = normalizeEvents([
    { type: "skill", name: "pm:dev" },
    { type: "tool", name: "functions.exec_command", command: "npm test", exit_code: 0 },
  ]);
  const neverRedResult = checkTranscript(neverRed, "test-red-green", "test");
  assert.equal(neverRedResult.status, "fail");
  assert.match(neverRedResult.reason, /no failing test run/);

  const noGreenAfterEdit = normalizeEvents([
    { type: "tool", name: "functions.exec_command", command: "npm test", exit_code: 1 },
    { type: "tool", name: "functions.apply_patch", command: "apply_patch src/x.js" },
  ]);
  assert.equal(checkTranscript(noGreenAfterEdit, "test-red-green", "test").status, "fail");

  const noExitCodes = normalizeEvents([
    { type: "tool", name: "functions.exec_command", command: "npm test" },
  ]);
  const noExitResult = checkTranscript(noExitCodes, "test-red-green", "test");
  assert.equal(noExitResult.status, "indeterminate");
  assert.equal(noExitResult.reason, "test-runs-missing-exit-codes");
});

test("shell reads of SKILL.md do not count as skill compliance", () => {
  const events = normalizeEvents([
    { type: "tool", name: "functions.exec_command", command: "sed -n '1,80p' skills/dev/SKILL.md" },
  ]);

  const result = checkTranscript(events, "skill-called", "pm:dev");
  assert.equal(result.status, "fail");
});

test("check frame parser accepts only current-phase nonce-tagged stdout frames", () => {
  const nonce = "abc123";
  const payload = Buffer.from(
    JSON.stringify({ helper: "check-transcript", status: "pass", reason: "ok" }),
    "utf8"
  ).toString("base64url");
  const stdout = [
    `${FRAME_PREFIX}${nonce}::${payload}`,
    `${FRAME_PREFIX}wrong::${payload}`,
    `${FRAME_PREFIX}${nonce}::not-json`,
  ].join("\n");

  const result = parseCheckFrames(stdout, { nonce, phase: "post", maxPayloadBytes: 1024 });
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].phase, "post");
  assert.equal(result.records[0].helper, "check-transcript");
  assert.ok(result.rejected.length >= 2);
});

test("frame-looking child output is escaped before log forwarding", () => {
  const escaped = escapeFrameLines(`${FRAME_PREFIX}abc::payload\nnormal`);
  assert.match(escaped, /^\\::pm-eval-check::/);
  assert.match(escaped, /normal$/);
});

test("prelude emits nonce-tagged check frames and hides nonce from child commands", () => {
  const script = `
    set -euo pipefail
    source ${JSON.stringify(preludePath)}
    __pm_eval_init post nonce123
    file-exists ${JSON.stringify(preludePath)}
    command-succeeds 'env | grep PM_EVAL_CHECK_NONCE'
  `;
  const output = execFileSync("bash", ["-c", script], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.match(output, new RegExp(`^${FRAME_PREFIX}nonce123::`, "m"));

  const parsed = parseCheckFrames(output, {
    phase: "post",
    nonce: "nonce123",
    maxPayloadBytes: 1024,
  });
  assert.equal(parsed.records.length, 2);
  assert.equal(parsed.records[0].helper, "file-exists");
  assert.equal(parsed.records[0].status, "pass");
  assert.equal(parsed.records[1].helper, "command-succeeds");
  assert.equal(parsed.records[1].status, "fail");
});
