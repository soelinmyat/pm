const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const dispatchPath = path.join(__dirname, "..", "scripts", "dev-runtime", "dispatch.js");

describe("dev runtime structured dispatch", () => {
  it("captures Codex JSONL identity and promotes the schema-constrained final message", () => {
    const fixture = createFixture("codex");
    try {
      const stub = [
        "#!/usr/bin/env node",
        'const fs = require("node:fs");',
        "const args = process.argv.slice(2);",
        'if (args.includes("--version")) { process.stdout.write("codex-cli 0.144.0\\n"); process.exit(0); }',
        'if (args.includes("--help")) { process.stdout.write(args.includes("resume") ? "exec resume --json --output-schema\\n" : "--sandbox --json --output-schema --output-last-message\\n"); process.exit(0); }',
        'const output = args[args.indexOf("--output-last-message") + 1];',
        `fs.writeFileSync(output, JSON.stringify(${JSON.stringify(validCompleted("codex"))}));`,
        'process.stdout.write(JSON.stringify({ type: "thread.started", thread_id: "thread-42" }) + "\\n");',
      ].join("\n");
      installStub(fixture.binDir, "codex", stub);
      runDispatch(fixture);

      const result = JSON.parse(fs.readFileSync(fixture.resultFile, "utf8"));
      const runtime = JSON.parse(fs.readFileSync(path.join(fixture.tmp, "runtime.json"), "utf8"));
      assert.equal(result.status, "completed");
      assert.equal(runtime.resume_id, "thread-42");
      assert.equal(runtime.model, "gpt-5.6-sol");
      assert.equal(runtime.external_effects, false);
      assert.match(fs.readFileSync(fixture.eventsFile, "utf8"), /thread\.started/);
    } finally {
      fs.rmSync(fixture.tmp, { recursive: true, force: true });
    }
  });

  it("promotes Claude stream-json structured output without an agent file write", () => {
    const fixture = createFixture("claude");
    try {
      const stub = [
        "#!/usr/bin/env node",
        "const args = process.argv.slice(2);",
        'if (args.includes("--version")) { process.stdout.write("2.1.207\\n"); process.exit(0); }',
        'if (args.includes("--help")) { process.stdout.write("--json-schema stream-json --resume --permission-mode auto\\n"); process.exit(0); }',
        'process.stdout.write(JSON.stringify({ type: "system", session_id: "session-9" }) + "\\n");',
        `process.stdout.write(JSON.stringify({ type: "result", session_id: "session-9", structured_output: ${JSON.stringify(validCompleted("claude"))} }) + "\\n");`,
      ].join("\n");
      installStub(fixture.binDir, "claude", stub);
      runDispatch(fixture);

      const result = JSON.parse(fs.readFileSync(fixture.resultFile, "utf8"));
      const runtime = JSON.parse(fs.readFileSync(path.join(fixture.tmp, "runtime.json"), "utf8"));
      assert.equal(result.status, "completed");
      assert.equal(runtime.resume_id, "session-9");
      assert.equal(runtime.model, "claude-opus-4-8");
      assert.equal(runtime.effort, "xhigh");
    } finally {
      fs.rmSync(fixture.tmp, { recursive: true, force: true });
    }
  });

  it("turns an agent-written malformed legacy result into a blocked result", () => {
    const fixture = createFixture("claude");
    try {
      const stub = [
        "#!/usr/bin/env node",
        'const fs = require("node:fs");',
        "const args = process.argv.slice(2);",
        'if (args.includes("--version")) { process.stdout.write("2.1.207\\n"); process.exit(0); }',
        'if (args.includes("--help")) { process.stdout.write("--json-schema stream-json --resume --permission-mode auto\\n"); process.exit(0); }',
        `fs.writeFileSync(${JSON.stringify(fixture.resultFile)}, '{"status":"completed"}');`,
      ].join("\n");
      installStub(fixture.binDir, "claude", stub);
      runDispatch(fixture);
      const result = JSON.parse(fs.readFileSync(fixture.resultFile, "utf8"));
      assert.equal(result.status, "blocked");
      assert.match(result.reason, /invalid result.*schema_version/);
    } finally {
      fs.rmSync(fixture.tmp, { recursive: true, force: true });
    }
  });
});

function createFixture(runtime) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `dev-runtime-${runtime}-`));
  const worktree = path.join(tmp, "worktree");
  const binDir = path.join(tmp, "bin");
  fs.mkdirSync(worktree);
  fs.mkdirSync(binDir);
  const promptFile = path.join(tmp, "prompt.txt");
  fs.writeFileSync(promptFile, "Implement the bounded unit.\n");
  const logFile = path.join(tmp, "run.log");
  return {
    runtime,
    tmp,
    worktree,
    binDir,
    promptFile,
    resultFile: path.join(tmp, "result.json"),
    logFile,
    eventsFile: path.join(tmp, "run.events.jsonl"),
  };
}

function validCompleted(provider) {
  return {
    schema_version: 1,
    work_unit_id: "unit-1",
    status: "completed",
    summary: "green",
    commit: null,
    files_changed: 1,
    evidence: [{ kind: "test" }],
    blocker: null,
    runtime: { provider },
  };
}

function installStub(binDir, name, body) {
  const file = path.join(binDir, name);
  fs.writeFileSync(file, body);
  fs.chmodSync(file, 0o755);
}

function runDispatch(fixture) {
  execFileSync(
    process.execPath,
    [
      dispatchPath,
      "--runtime",
      fixture.runtime,
      "--worktree",
      fixture.worktree,
      "--prompt-file",
      fixture.promptFile,
      "--result-file",
      fixture.resultFile,
      "--log-file",
      fixture.logFile,
    ],
    {
      env: { ...process.env, PATH: `${fixture.binDir}${path.delimiter}${process.env.PATH}` },
    }
  );
}
