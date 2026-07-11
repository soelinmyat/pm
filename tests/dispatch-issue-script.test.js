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

  it("delegates provider policy to the Node runtime adapter", () => {
    const src = fs.readFileSync(scriptPath, "utf8");
    assert.match(src, /dev-runtime\/dispatch\.js/);
    assert.doesNotMatch(src, /--dangerously-skip-permissions/);
    assert.doesNotMatch(src, /--full-auto/);
    assert.doesNotMatch(src, /--model\s+opus\b/);
  });

  // End-to-end check of placeholder resolution + result-file path handling.
  // A stub `claude` on PATH stands in for the real runtime: it captures the
  // resolved prompt and writes a result where the prompt tells it to.
  it("resolves plugin root placeholders / ${RESULT_FILE} and locates the result file from any cwd", () => {
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
        'if [ "${1:-}" = "--version" ]; then echo "2.1.207"; exit 0; fi',
        'if [ "${1:-}" = "--help" ]; then echo "--json-schema stream-json --resume --permission-mode auto"; exit 0; fi',
        'prompt="$(cat)"',
        `printf '%s' "$prompt" > ${JSON.stringify(promptDump)}`,
        `printf '\\nENV_PM_PLUGIN_ROOT=%s\\nENV_CLAUDE_PLUGIN_ROOT=%s\\n' "$PM_PLUGIN_ROOT" "$CLAUDE_PLUGIN_ROOT" >> ${JSON.stringify(promptDump)}`,
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
        "Read ${PM_PLUGIN_ROOT}/skills/dev/references/implementation-flow.md\n" +
          "Legacy ${CLAUDE_PLUGIN_ROOT}/skills/dev/references/implementation-flow.md\n" +
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
          env: {
            ...process.env,
            PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
          },
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
        !received.includes("${PM_PLUGIN_ROOT}"),
        "${PM_PLUGIN_ROOT} must be resolved before the subprocess sees it"
      );
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
        "${PM_PLUGIN_ROOT} must resolve to an absolute plugin path"
      );
      assert.match(
        received,
        /Legacy \/.+\/skills\/dev\/references\/implementation-flow\.md/,
        "${CLAUDE_PLUGIN_ROOT} legacy alias must resolve to an absolute plugin path"
      );
      assert.match(
        received,
        /ENV_PM_PLUGIN_ROOT=\/.+\nENV_CLAUDE_PLUGIN_ROOT=\/.+/,
        "dispatcher must export both plugin-root env vars to subprocesses"
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  // Guards the wait-loop-hang bug: if the subprocess exits without writing a
  // result file, the dispatcher's EXIT trap must leave a stub blocked result
  // behind so the orchestrator's `until [ -f result.json ]` wait terminates.
  // Without this, an empty log + no result = orchestrator hangs forever.
  it("leaves a stub blocked result when the subprocess exits without writing one", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-issue-stub-"));
    try {
      const worktree = path.join(tmp, "wt");
      const binDir = path.join(tmp, "bin");
      fs.mkdirSync(worktree);
      fs.mkdirSync(binDir);

      // Stub runtime: drain stdin and exit 0 WITHOUT writing the result file.
      // Mimics a subprocess that crashed mid-run or silently bailed.
      const stub = ["#!/usr/bin/env bash", "cat > /dev/null", "exit 0"].join("\n");
      const stubPath = path.join(binDir, "claude");
      fs.writeFileSync(stubPath, stub);
      fs.chmodSync(stubPath, 0o755);

      const promptFile = path.join(tmp, "prompt.txt");
      fs.writeFileSync(promptFile, "noop\n");

      const resultFile = path.join(tmp, "result.json");

      // Dispatcher exits non-zero (exit 4 — subprocess wrote no result) but
      // the EXIT trap fires anyway and leaves a stub result behind.
      let exitCode = 0;
      try {
        execFileSync(
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
            resultFile,
          ],
          {
            env: {
              ...process.env,
              PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
            },
            encoding: "utf8",
            stdio: "pipe",
          }
        );
      } catch (err) {
        exitCode = err.status;
      }

      assert.equal(exitCode, 4, "dispatcher should still exit 4 to flag missing-result");
      assert.ok(fs.existsSync(resultFile), "stub result.json must exist after dispatcher exits");
      const stub_result = JSON.parse(fs.readFileSync(resultFile, "utf8"));
      assert.equal(stub_result.status, "blocked", "stub must report blocked status");
      assert.ok(stub_result.reason, "stub must include a human-readable reason");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  // The dispatch.pid file is the orchestrator's escape hatch: if the
  // dispatcher dies via SIGKILL (bypassing the EXIT trap), the orchestrator's
  // wait loop checks `kill -0 $(cat dispatch.pid)` to detect the death.
  // Verify the file is written during run and removed on clean exit.
  it("writes dispatch.pid during run and removes it on clean exit", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-issue-pid-"));
    try {
      const worktree = path.join(tmp, "wt");
      const binDir = path.join(tmp, "bin");
      fs.mkdirSync(worktree);
      fs.mkdirSync(binDir);

      const resultFile = path.join(tmp, "result.json");
      const pidFile = path.join(tmp, "dispatch.pid");
      const pidSnapshot = path.join(tmp, "pid-during-run.txt");

      // Stub runtime: snapshot dispatch.pid mid-run (proves it exists while
      // the subprocess is active), then write a merged result.
      const stub = [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        "cat > /dev/null",
        `cp ${JSON.stringify(pidFile)} ${JSON.stringify(pidSnapshot)}`,
        `echo '{"status":"merged","issue_id":"X","pr":1,"merge_sha":"a","files_changed":0}' > ${JSON.stringify(resultFile)}`,
      ].join("\n");
      const stubPath = path.join(binDir, "claude");
      fs.writeFileSync(stubPath, stub);
      fs.chmodSync(stubPath, 0o755);

      const promptFile = path.join(tmp, "prompt.txt");
      fs.writeFileSync(promptFile, "noop\n");

      execFileSync(
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
          resultFile,
        ],
        {
          env: {
            ...process.env,
            PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
          },
          encoding: "utf8",
        }
      );

      assert.ok(fs.existsSync(pidSnapshot), "dispatch.pid must exist while subprocess is running");
      const recordedPid = fs.readFileSync(pidSnapshot, "utf8").trim();
      assert.match(recordedPid, /^\d+$/, "dispatch.pid must contain a numeric PID");
      assert.ok(!fs.existsSync(pidFile), "dispatch.pid must be removed on clean exit");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("surfaces Claude usage-limit stops as blocked results", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-issue-limit-"));
    try {
      const worktree = path.join(tmp, "wt");
      const binDir = path.join(tmp, "bin");
      fs.mkdirSync(worktree);
      fs.mkdirSync(binDir);

      const resultFile = path.join(tmp, "result.json");
      const logFile = path.join(tmp, "run.log");

      // Stub runtime: emit a limit error and exit without writing result.json.
      // The dispatcher should classify this before the generic trap result.
      const stub = [
        "#!/usr/bin/env bash",
        'if [ "${1:-}" = "--version" ]; then echo "2.1.207"; exit 0; fi',
        'if [ "${1:-}" = "--help" ]; then echo "--json-schema stream-json --resume --permission-mode auto"; exit 0; fi',
        "cat > /dev/null",
        "echo 'usage limit reached' >&2",
        "exit 1",
      ].join("\n");
      const stubPath = path.join(binDir, "claude");
      fs.writeFileSync(stubPath, stub);
      fs.chmodSync(stubPath, 0o755);

      const promptFile = path.join(tmp, "prompt.txt");
      fs.writeFileSync(promptFile, "noop\n");

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
          resultFile,
          "--log-file",
          logFile,
        ],
        {
          env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}` },
          encoding: "utf8",
        }
      );

      assert.match(out, /"status"\s*:\s*"blocked"/);
      const result = JSON.parse(fs.readFileSync(resultFile, "utf8"));
      assert.equal(result.status, "blocked", "limit stop must be a blocked result");
      assert.match(result.reason, /normal subscription usage limits/);
      assert.equal(result.runtime.log_file, logFile);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  // Claude paused the previously announced Agent SDK credit split, so an
  // unset PM_ALLOW_SUBPROCESS must not block `claude -p` dispatch.
  it("dispatches when PM_ALLOW_SUBPROCESS is unset", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-issue-gate-"));
    try {
      const worktree = path.join(tmp, "wt");
      const binDir = path.join(tmp, "bin");
      fs.mkdirSync(worktree);
      fs.mkdirSync(binDir);

      const resultFile = path.join(tmp, "result.json");
      const invokedMarker = path.join(tmp, "claude-was-invoked");

      // Stub runtime: if dispatch works it leaves a marker and writes the
      // merged result. PM_ALLOW_SUBPROCESS is deliberately absent.
      const stub = [
        "#!/usr/bin/env bash",
        "cat > /dev/null",
        `touch ${JSON.stringify(invokedMarker)}`,
        `echo '{"status":"merged","issue_id":"X","pr":1,"merge_sha":"a","files_changed":0}' > ${JSON.stringify(resultFile)}`,
      ].join("\n");
      const stubPath = path.join(binDir, "claude");
      fs.writeFileSync(stubPath, stub);
      fs.chmodSync(stubPath, 0o755);

      const promptFile = path.join(tmp, "prompt.txt");
      fs.writeFileSync(promptFile, "noop\n");

      // Env deliberately WITHOUT PM_ALLOW_SUBPROCESS.
      const env = { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}` };
      delete env.PM_ALLOW_SUBPROCESS;

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
          resultFile,
        ],
        { env, encoding: "utf8" }
      );

      assert.ok(fs.existsSync(invokedMarker), "claude -p must be invoked without the old gate");
      assert.match(out, /"status"\s*:\s*"merged"/);
      const result = JSON.parse(fs.readFileSync(resultFile, "utf8"));
      assert.equal(result.status, "merged", "dispatcher should return the subprocess result");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("codex subprocess uses the structured adapter with safe model and sandbox args", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-issue-codex-"));
    try {
      const worktree = path.join(tmp, "wt");
      const binDir = path.join(tmp, "bin");
      const resultDir = path.join(tmp, "external-pm-state", "runs", "issue-1");
      fs.mkdirSync(worktree, { recursive: true });
      fs.mkdirSync(binDir, { recursive: true });
      fs.mkdirSync(resultDir, { recursive: true });

      const argvDump = path.join(tmp, "codex-argv.json");
      const stdinDump = path.join(tmp, "codex-stdin.txt");
      const resultFile = path.join(resultDir, "result.json");

      const stub = [
        "#!/usr/bin/env node",
        'const fs = require("node:fs");',
        "const args = process.argv.slice(2);",
        'if (args.includes("--version")) { process.stdout.write("codex-cli 0.144.0\\n"); process.exit(0); }',
        'if (args.includes("--help")) { process.stdout.write(args.includes("resume") ? "exec resume --json --output-schema\\n" : "--sandbox --json --output-schema --output-last-message\\n"); process.exit(0); }',
        `fs.writeFileSync(${JSON.stringify(argvDump)}, JSON.stringify(process.argv.slice(2)));`,
        'let input = "";',
        'process.stdin.setEncoding("utf8");',
        'process.stdin.on("data", (c) => { input += c; });',
        'process.stdin.on("end", () => {',
        `  fs.writeFileSync(${JSON.stringify(stdinDump)}, input);`,
        `  fs.writeFileSync(${JSON.stringify(resultFile)}, '{"status":"merged","issue_id":"X","pr":1,"merge_sha":"a","files_changed":0}\\n');`,
        "});",
      ].join("\n");
      const stubPath = path.join(binDir, "codex");
      fs.writeFileSync(stubPath, stub);
      fs.chmodSync(stubPath, 0o755);

      const promptFile = path.join(tmp, "prompt.txt");
      fs.writeFileSync(promptFile, "RESULT_PATH=${RESULT_FILE}\n");

      const out = execFileSync(
        "bash",
        [
          scriptPath,
          "--runtime",
          "codex",
          "--worktree",
          worktree,
          "--prompt-file",
          promptFile,
          "--result-file",
          resultFile,
        ],
        {
          env: {
            ...process.env,
            PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
          },
          encoding: "utf8",
        }
      );

      assert.match(out, /"status"\s*:\s*"merged"/);
      const argv = JSON.parse(fs.readFileSync(argvDump, "utf8"));
      assert.deepEqual(argv.slice(0, 3), ["exec", "--model", "gpt-5.6-sol"]);
      assert.ok(argv.includes("workspace-write"));
      assert.ok(argv.includes('model_reasoning_effort="high"'));
      assert.ok(argv.includes("--output-schema"));
      assert.ok(argv.includes("--json"));
      assert.ok(!argv.includes("--full-auto"));
      assert.ok(!argv.includes("--add-dir"));
      assert.ok(argv.includes("-C"));
      assert.ok(argv.includes(worktree));
      assert.ok(fs.readFileSync(stdinDump, "utf8").includes(`RESULT_PATH=${resultFile}`));
      assert.match(fs.readFileSync(stdinDump, "utf8"), /Root-owned external effects/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("claude subprocess uses Opus 4.8 xhigh, auto permissions, and structured output", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-issue-claude-argv-"));
    try {
      const worktree = path.join(tmp, "wt");
      const binDir = path.join(tmp, "bin");
      fs.mkdirSync(worktree);
      fs.mkdirSync(binDir);
      const argvDump = path.join(tmp, "claude-argv.json");
      const resultFile = path.join(tmp, "result.json");
      const completedResult = `${JSON.stringify({
        schema_version: 1,
        work_unit_id: "legacy",
        status: "completed",
        summary: "done",
        commit: "abc123",
        files_changed: 1,
        evidence: [{ kind: "test", exit_code: 0 }],
        blocker: null,
        runtime: { provider: "claude" },
      })}\n`;
      const stub = [
        "#!/usr/bin/env node",
        'const fs = require("node:fs");',
        "const args = process.argv.slice(2);",
        'if (args.includes("--version")) { process.stdout.write("2.1.207\\n"); process.exit(0); }',
        'if (args.includes("--help")) { process.stdout.write("--json-schema stream-json --resume --permission-mode auto\\n"); process.exit(0); }',
        `fs.writeFileSync(${JSON.stringify(argvDump)}, JSON.stringify(process.argv.slice(2)));`,
        "process.stdin.resume();",
        'process.stdin.on("end", () => {',
        `  fs.writeFileSync(${JSON.stringify(resultFile)}, ${JSON.stringify(completedResult)});`,
        "});",
      ].join("\n");
      const stubPath = path.join(binDir, "claude");
      fs.writeFileSync(stubPath, stub);
      fs.chmodSync(stubPath, 0o755);
      const promptFile = path.join(tmp, "prompt.txt");
      fs.writeFileSync(promptFile, "implement\n");

      execFileSync(
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
          resultFile,
        ],
        { env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}` } }
      );

      const argv = JSON.parse(fs.readFileSync(argvDump, "utf8"));
      assert.deepEqual(argv.slice(0, 5), ["-p", "--model", "claude-opus-4-8", "--effort", "xhigh"]);
      assert.ok(argv.includes("auto"));
      assert.ok(argv.includes("stream-json"));
      assert.ok(argv.includes("--json-schema"));
      assert.ok(!argv.includes("--dangerously-skip-permissions"));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
