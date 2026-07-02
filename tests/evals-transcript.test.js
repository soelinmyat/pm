"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
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

test("transcript helpers can order skills before matching shell commands", () => {
  const pushOrPr = String.raw`\b(git\s+push|gh\s+pr\s+(create|merge))\b`;
  const setupReviewPush = normalizeEvents([
    { type: "tool", name: "functions.exec_command", command: "sed -n '1,80p' skills/dev/SKILL.md" },
    { type: "skill", name: "pm:review" },
    {
      type: "tool",
      name: "functions.exec_command",
      command: "/bin/zsh -lc 'git push -u origin branch'",
    },
  ]);
  const pushThenReview = normalizeEvents([
    { type: "tool", name: "functions.exec_command", command: "/bin/zsh -lc 'gh pr create --fill'" },
    { type: "skill", name: "pm:review" },
  ]);
  const reviewWithoutPush = normalizeEvents([
    { type: "tool", name: "functions.exec_command", command: "npm test" },
    { type: "skill", name: "pm:review" },
  ]);

  assert.equal(
    checkTranscript(setupReviewPush, "skill-before-command", "pm:review", pushOrPr).status,
    "pass"
  );
  assert.equal(
    checkTranscript(reviewWithoutPush, "skill-before-command", "pm:review", pushOrPr).status,
    "pass"
  );

  const failed = checkTranscript(pushThenReview, "skill-before-command", "pm:review", pushOrPr);
  assert.equal(failed.status, "fail");
  assert.match(failed.reason, /command matched before skill/);

  const invalid = checkTranscript(setupReviewPush, "skill-before-command", "pm:review", "[");
  assert.equal(invalid.status, "indeterminate");
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

test("regex needles match -C phrasings that substrings miss and skip benign forms", () => {
  const events = normalizeEvents([
    { type: "tool", name: "functions.exec_command", command: "git -C app push origin main" },
    { type: "tool", name: "functions.exec_command", command: "git merge-base origin/main HEAD" },
  ]);

  // Substring misses the -C form; regex catches it.
  assert.equal(checkTranscript(events, "tool-called", "run-command~git push").status, "fail");
  assert.equal(
    checkTranscript(events, "tool-called", "run-command~/git\\s+(-C\\s+\\S+\\s+)?push/").status,
    "pass"
  );
  // A merge guard as regex does not trip on merge-base ancestry probes.
  assert.equal(
    checkTranscript(events, "tool-not-called", "run-command~/git\\s+(-C\\s+\\S+\\s+)?merge(\\s|$)/")
      .status,
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

test("test-red-green detects red runs masked by pipelines via result text", () => {
  const events = normalizeEvents([
    { type: "skill", name: "pm:dev" },
    {
      type: "tool",
      name: "Bash",
      command: "npm test 2>&1 | tail -30",
      exit_code: 0,
      result_snippet: "# tests 3\n# pass 2\n# fail 1\nnot ok 3 - slugify strips symbols",
    },
    { type: "tool", name: "Edit", command: "src/strings.js" },
    {
      type: "tool",
      name: "Bash",
      command: "npm test 2>&1 | tail -30",
      exit_code: 0,
      result_snippet: "# tests 3\n# pass 3\n# fail 0",
    },
  ]);
  assert.equal(checkTranscript(events, "test-red-green", "test").status, "pass");
});

test("gate-evidence accepts skill, agent dispatch, or observed activity — nothing else", () => {
  const AGENT_RE = "pm:designer";
  const ACT_RE = "playwright|screenshot";
  const viaActivity = normalizeEvents([
    { type: "skill", name: "pm:dev" },
    {
      type: "tool",
      name: "Bash",
      command: "npx playwright screenshot --viewport-size=375,812 page.html shot.png",
      exit_code: 0,
    },
  ]);
  assert.equal(
    checkTranscript(viaActivity, "gate-evidence", "pm:design-critique", AGENT_RE, ACT_RE).status,
    "pass"
  );
  const nothing = normalizeEvents([
    { type: "skill", name: "pm:dev" },
    { type: "tool", name: "Bash", command: "npm test", exit_code: 0 },
  ]);
  assert.equal(
    checkTranscript(nothing, "gate-evidence", "pm:design-critique", AGENT_RE, ACT_RE).status,
    "fail"
  );
});

test("skill-or-agent accepts either invocation or matching agent dispatch", () => {
  const viaSkill = normalizeEvents([{ type: "skill", name: "pm:design-critique" }]);
  assert.equal(
    checkTranscript(viaSkill, "skill-or-agent", "pm:design-critique", "designer").status,
    "pass"
  );

  const viaAgent = normalizeEvents([
    { type: "skill", name: "pm:dev" },
    { type: "tool", name: "Task", command: "pm:designer Review the captured CLI output" },
  ]);
  assert.equal(
    checkTranscript(
      viaAgent,
      "skill-or-agent",
      "pm:design-critique",
      "design.?critique|pm:designer"
    ).status,
    "pass"
  );

  const neither = normalizeEvents([
    { type: "skill", name: "pm:dev" },
    { type: "tool", name: "Bash", command: "echo done", exit_code: 0 },
  ]);
  assert.equal(
    checkTranscript(neither, "skill-or-agent", "pm:design-critique", "pm:designer").status,
    "fail"
  );
});

test("incidental failure-ish text neither fakes red nor poisons green", () => {
  // Passing suite whose output mentions a test NAMED with failure words:
  const greenWithNoise = normalizeEvents([
    { type: "skill", name: "pm:dev" },
    {
      type: "tool",
      name: "Bash",
      command: "npm test 2>&1 | cat",
      exit_code: 0,
      result_snippet:
        "ok 1 - handles 3 failed retries gracefully\nok 2 - x\n# tests 2\n# pass 2\n# fail 0",
    },
  ]);
  // No real red anywhere → fail with "no failing test run", NOT a fake pass.
  const res = checkTranscript(greenWithNoise, "test-red-green", "test");
  assert.equal(res.status, "fail");
  assert.match(res.reason, /no failing test run/);

  // Jest and pytest summaries still count as red when masked by pipes:
  for (const snippet of [
    "Tests:       1 failed, 2 passed, 3 total",
    "==================== 1 failed, 2 passed in 0.12s ====================",
  ]) {
    const events = normalizeEvents([
      {
        type: "tool",
        name: "Bash",
        command: "npm test | cat",
        exit_code: 0,
        result_snippet: snippet,
      },
      { type: "tool", name: "Edit", command: "src/x.js" },
      {
        type: "tool",
        name: "Bash",
        command: "npm test | cat",
        exit_code: 0,
        result_snippet: "# fail 0\n# pass 3",
      },
    ]);
    assert.equal(checkTranscript(events, "test-red-green", "test").status, "pass", snippet);
  }
});

test("shell reads of SKILL.md do not count as skill compliance", () => {
  const events = normalizeEvents([
    { type: "tool", name: "functions.exec_command", command: "sed -n '1,80p' skills/dev/SKILL.md" },
  ]);

  const result = checkTranscript(events, "skill-called", "pm:dev");
  assert.equal(result.status, "fail");
});

test("codex agent messages and command executions normalize to PM skill and shell tool events", () => {
  const events = normalizeEvents([
    {
      type: "item.completed",
      item: {
        type: "agent_message",
        text: "I’ll use the PM workflow skills for this turn: `pm:dev` for implementation and `pm:review` before handoff.",
      },
    },
    {
      type: "item.started",
      item: {
        type: "command_execution",
        command: '/bin/zsh -lc "node --test tests/example.test.js"',
      },
    },
  ]);

  assert.equal(checkTranscript(events, "skill-called", "pm:dev").status, "pass");
  assert.equal(checkTranscript(events, "skill-called", "pm:review").status, "pass");
  assert.equal(checkTranscript(events, "tool-called", "functions.exec_command").status, "pass");
  assert.equal(
    checkTranscript(events, "skill-before-tool", "pm:dev", "functions.exec_command").status,
    "pass"
  );
});

test("codex skill-name mentions without use intent do not count as skill compliance", () => {
  const events = normalizeEvents([
    {
      type: "item.completed",
      item: {
        type: "agent_message",
        text: "The scenario expects `pm:dev`, but I will inspect the fixture directly first.",
      },
    },
    {
      type: "item.completed",
      item: {
        type: "agent_message",
        text: "I will not use `pm:review` for this small check.",
      },
    },
  ]);

  assert.equal(checkTranscript(events, "skill-called", "pm:dev").status, "fail");
  assert.equal(checkTranscript(events, "skill-called", "pm:review").status, "fail");
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
  const artifactsDir = path.join(repoRoot, "eval-results", "tmp-prelude-artifacts");
  fs.rmSync(artifactsDir, { recursive: true, force: true });
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(path.join(artifactsDir, "report.md"), "planted bug: items.length = 0\n");
  const script = `
    set -euo pipefail
    source ${JSON.stringify(preludePath)}
    __pm_eval_init post nonce123
    file-exists ${JSON.stringify(preludePath)}
    PM_EVAL_ARTIFACTS_DIR=${JSON.stringify(artifactsDir)} artifact-contains report.md 'items.length = 0'
    command-succeeds 'env | grep PM_EVAL_CHECK_NONCE'
  `;
  try {
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
    assert.equal(parsed.records.length, 3);
    assert.equal(parsed.records[0].helper, "file-exists");
    assert.equal(parsed.records[0].status, "pass");
    assert.equal(parsed.records[1].helper, "artifact-contains");
    assert.equal(parsed.records[1].status, "pass");
    assert.equal(parsed.records[2].helper, "command-succeeds");
    assert.equal(parsed.records[2].status, "fail");
  } finally {
    fs.rmSync(artifactsDir, { recursive: true, force: true });
  }
});
