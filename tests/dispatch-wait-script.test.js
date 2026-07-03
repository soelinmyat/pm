const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync, spawnSync, spawn } = require("node:child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const repoRoot = path.join(__dirname, "..");
const scriptPath = path.join(repoRoot, "scripts", "dispatch-wait.sh");

// Run dispatch-wait.sh and return its single stdout JSON line, parsed.
// The helper's whole contract is "print exactly one JSON line", so any run
// that does not yield exactly one parseable line is a contract violation.
function runWait(args, opts = {}) {
  const out = execFileSync("bash", [scriptPath, ...args], {
    encoding: "utf8",
    ...opts,
  });
  const lines = out.split("\n").filter((l) => l.trim().length > 0);
  assert.equal(lines.length, 1, `expected exactly one output line, got:\n${out}`);
  return JSON.parse(lines[0]);
}

describe("dispatch-wait.sh", () => {
  it("script exists and is syntactically valid bash", () => {
    assert.ok(fs.existsSync(scriptPath), "scripts/dispatch-wait.sh must exist");
    // `bash -n` parses without executing; throws on syntax error.
    execFileSync("bash", ["-n", scriptPath]);
  });

  // DONE: the subprocess wrote a well-formed result.json. The helper must
  // report state=done and nest the parsed result so the orchestrator reads
  // .result.status without a second file read.
  it("reports done and nests the result when result.json exists and is valid", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-wait-done-"));
    try {
      const resultFile = path.join(tmp, "result.json");
      const result = {
        status: "merged",
        issue_id: "PM-1.1",
        pr: 1067,
        merge_sha: "abc123",
        files_changed: 31,
      };
      fs.writeFileSync(resultFile, JSON.stringify(result) + "\n");
      // A stale live pid must not override a present result — result wins.
      fs.writeFileSync(path.join(tmp, "dispatch.pid"), String(process.pid) + "\n");

      const parsed = runWait(["--result-file", resultFile, "--timeout", "1", "--interval", "1"]);
      assert.equal(parsed.state, "done");
      assert.deepEqual(parsed.result, result, "done state must nest the parsed result.json");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  // CRASHED: dispatch.pid points at a dead process and no result.json exists.
  // This is the SIGKILL / trap-bypass case — the EXIT-trap stub never got
  // written. The helper must fail closed as crashed so the orchestrator halts
  // instead of waiting forever.
  it("reports crashed when the pid is dead and no result was written", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-wait-crash-"));
    try {
      const resultFile = path.join(tmp, "result.json");
      const pidFile = path.join(tmp, "dispatch.pid");

      // Spawn a process that exits immediately; spawnSync returns after it has
      // exited, so its pid is now dead (kill -0 => ESRCH).
      const dead = spawnSync(process.execPath, ["-e", ""]);
      assert.ok(dead.pid, "expected a pid for the throwaway process");
      fs.writeFileSync(pidFile, String(dead.pid) + "\n");
      assert.ok(!fs.existsSync(resultFile), "precondition: no result file");

      const parsed = runWait(["--result-file", resultFile, "--timeout", "5", "--interval", "1"]);
      assert.equal(parsed.state, "crashed");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  // RUNNING: the subprocess is still alive and has not written a result when
  // the per-invocation ceiling elapses. The helper must report running so the
  // orchestrator re-invokes it (the heartbeat), NOT halt.
  it("reports running when the pid is alive and the timeout elapses with no result", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-wait-run-"));
    // Long-lived child stands in for a busy subprocess.
    const child = spawn("sleep", ["30"], { stdio: "ignore" });
    try {
      const resultFile = path.join(tmp, "result.json");
      fs.writeFileSync(path.join(tmp, "dispatch.pid"), String(child.pid) + "\n");

      const parsed = runWait(["--result-file", resultFile, "--timeout", "1", "--interval", "1"]);
      assert.equal(parsed.state, "running");
      assert.ok(!fs.existsSync(resultFile), "running state must not fabricate a result");
    } finally {
      child.kill("SIGKILL");
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  // MALFORMED: result.json exists but is not valid JSON. Fail closed as
  // crashed — a garbage result is worse than no result, and advancing on it
  // would corrupt the plan.
  it("reports crashed when result.json exists but is malformed (fail closed)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-wait-malformed-"));
    try {
      const resultFile = path.join(tmp, "result.json");
      fs.writeFileSync(resultFile, "{ status: not json, truncated");

      const parsed = runWait(["--result-file", resultFile, "--timeout", "1", "--interval", "1"]);
      assert.equal(parsed.state, "crashed");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  // The default per-invocation ceiling is 900s. Pin it so a refactor cannot
  // silently drop the hard bound the whole heartbeat design depends on.
  it("documents a hard 900s default ceiling", () => {
    const src = fs.readFileSync(scriptPath, "utf8");
    assert.match(src, /\b900\b/, "helper must carry the 900s default ceiling");
  });
});
