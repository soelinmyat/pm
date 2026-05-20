const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const repoRoot = path.join(__dirname, "..");
const scriptPath = path.join(repoRoot, "scripts", "dispatch-issue.sh");

describe("dispatch-issue.sh", () => {
  it("script exists and is syntactically valid bash", () => {
    assert.ok(fs.existsSync(scriptPath), "scripts/dispatch-issue.sh must exist");
    // `bash -n` parses without executing; throws on syntax error.
    execFileSync("bash", ["-n", scriptPath]);
  });

  it("claude subprocess pins --model opus", () => {
    // A spawned `claude -p` subprocess does NOT inherit the orchestrator's
    // model and would fall back to the config default (Sonnet), silently
    // degrading implementation quality. The claude runtime branch must pin
    // the model explicitly.
    const src = fs.readFileSync(scriptPath, "utf8");
    const claudeBranch = src.slice(src.indexOf("\n  claude)"), src.indexOf("\n  codex)"));
    assert.ok(claudeBranch.length > 0, "claude runtime branch must exist before the codex branch");
    assert.match(
      claudeBranch,
      /--model\s+opus\b/,
      "claude branch must pass `--model opus` to `claude -p`"
    );
  });

  // End-to-end check of placeholder resolution + result-file path handling.
  // A stub `claude` on PATH stands in for the real runtime: it captures the
  // resolved prompt and writes a result where the prompt tells it to.
  it("resolves ${CLAUDE_PLUGIN_ROOT} / ${RESULT_FILE} and locates the result file from any cwd", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-issue-"));
    try {
      const worktree = path.join(tmp, "wt");
      const binDir = path.join(tmp, "bin");
      fs.mkdirSync(worktree);
      fs.mkdirSync(binDir);

      const promptDump = path.join(tmp, "received-prompt.txt");

      // Stub runtime: save the prompt it received, then act on it the way a
      // real agent would — pull the result path out of the prompt and write
      // a merged result there. It runs with cwd inside the worktree (the
      // script cd's there), so a correct run must use an absolute path.
      const stub = [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        'prompt="$(cat)"',
        `printf '%s' "$prompt" > ${JSON.stringify(promptDump)}`,
        `rf="$(printf '%s\\n' "$prompt" | sed -n 's/^RESULT_PATH=//p')"`,
        'echo \'{"status":"merged","issue_id":"PM-1.1","pr":1,"merge_sha":"abc","files_changed":1}\' > "$rf"',
      ].join("\n");
      const stubPath = path.join(binDir, "claude");
      fs.writeFileSync(stubPath, stub);
      fs.chmodSync(stubPath, 0o755);

      // Prompt carries the literal placeholders the dispatcher must resolve.
      const promptFile = path.join(tmp, "prompt.txt");
      fs.writeFileSync(
        promptFile,
        "Read ${CLAUDE_PLUGIN_ROOT}/skills/dev/references/implementation-flow.md\n" +
          "RESULT_PATH=${RESULT_FILE}\n"
      );

      // --result-file is RELATIVE and cwd is tmp (NOT the worktree). The bug
      // this guards: a relative path resolving against the worktree instead,
      // so the script never finds the result the agent actually wrote.
      const out = execFileSync(
        "bash",
        [
          scriptPath,
          "--runtime",
          "claude",
          "--worktree",
          worktree,
          "--prompt-file",
          promptFile,
          "--result-file",
          "result.json",
        ],
        {
          cwd: tmp,
          env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}` },
          encoding: "utf8",
        }
      );

      // Exit 0 + echoed result => the script found result.json where it
      // resolved --result-file (tmp/result.json), not under the worktree.
      assert.match(out, /"status"\s*:\s*"merged"/);
      assert.ok(
        fs.existsSync(path.join(tmp, "result.json")),
        "result.json must land beside the orchestrator cwd"
      );
      assert.ok(
        !fs.existsSync(path.join(worktree, "result.json")),
        "result.json must NOT land inside the worktree"
      );

      const received = fs.readFileSync(promptDump, "utf8");
      assert.ok(
        !received.includes("${CLAUDE_PLUGIN_ROOT}"),
        "${CLAUDE_PLUGIN_ROOT} must be resolved before the subprocess sees it"
      );
      assert.ok(
        !received.includes("${RESULT_FILE}"),
        "${RESULT_FILE} must be resolved before the subprocess sees it"
      );
      assert.match(
        received,
        /Read \/.+\/skills\/dev\/references\/implementation-flow\.md/,
        "${CLAUDE_PLUGIN_ROOT} must resolve to an absolute plugin path"
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
