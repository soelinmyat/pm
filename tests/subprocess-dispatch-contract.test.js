"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// ---------------------------------------------------------------------------
// D5 review — the canonical wait/branch contract lives in agent-runtime.md
// § Subprocess Dispatch. These pins guard the review-mandated prose:
//   * the branch-before-refire HARD-RULE (guards MODEL behavior — reflexive
//     re-firing — which the JSON sentinel did not make obsolete)
//   * the two edge rows in the branch table
//   * the de-staled runtime-agnostic example (background dispatch + dispatch-wait
//     + branch on .state, NOT foreground dispatch-issue + direct result read)
// ---------------------------------------------------------------------------

const repoRoot = path.resolve(__dirname, "..");
const RUNTIME = "skills/dev/references/agent-runtime.md";

function read(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("agent-runtime restores the branch-before-refire HARD-RULE", () => {
  const text = read(RUNTIME);
  const rule = text.match(/<HARD-RULE>[\s\S]*?<\/HARD-RULE>/g) || [];
  const branchRule = rule.find((r) => /read `\.state` and branch/i.test(r));
  assert.ok(branchRule, "a HARD-RULE must cover reading .state before re-firing");
  assert.match(branchRule, /only.*state that re-invokes/i);
  assert.match(branchRule, /never reflexively re-fire/i);
  // The rule is about model behavior, not the sentinel format.
  assert.match(branchRule, /fire-and-forget/i);
});

test("agent-runtime branch table carries the two edge rows", () => {
  const text = read(RUNTIME);
  assert.match(text, /output missing or unparseable[\s\S]*Treat as `crashed`/);
  assert.match(
    text,
    /`done` but `\.result\.status` ∉ \{`merged`, `blocked`\}[\s\S]*Treat as `blocked`/
  );
  // crashed row now names the full failure set incl. never-started + recycled.
  assert.match(text, /never started, recycled to an unrelated PID, or an unparseable result/);
});

test("agent-runtime runtime-agnostic example is not the stale synchronous one", () => {
  const text = read(RUNTIME);
  const example = text.match(/### Subprocess dispatch \(runtime-agnostic\)[\s\S]*?```\n/);
  assert.ok(example, "the runtime-agnostic example block must exist");
  const block = example[0];
  // Background dispatch, then wait via the helper and branch on .state.
  assert.match(
    block,
    /scripts\/dispatch-issue\.sh[\s\S]*?--result-file[\s\S]*?&/,
    "must background-dispatch"
  );
  assert.match(block, /scripts\/dispatch-wait\.sh/, "must wait via the helper");
  assert.match(block, /jq -r '\.state'/, "must branch on .state");
  // The stale anti-pattern: reading result.json's status directly must be gone.
  assert.doesNotMatch(block, /jq -r '\.status'/, "must not read result.json status directly");
  // Atomic-write guidance folded into the prompt template.
  assert.match(block, /\$\{RESULT_FILE\}\.tmp then mv/);
});
