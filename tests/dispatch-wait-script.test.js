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

// A live process whose command line contains "dispatch-issue" — i.e. it looks
// like the real dispatcher to the helper's ps-identity check.
function spawnOursAlive() {
  return spawn(
    process.execPath,
    ["-e", "setTimeout(() => {}, 60000)", "dispatch-issue-heartbeat"],
    { stdio: "ignore" }
  );
}

// A live process that is NOT the dispatcher (stands in for a recycled PID
// the OS handed to an unrelated program).
function spawnUnrelatedAlive() {
  return spawn("sleep", ["60"], { stdio: "ignore" });
}

// A pid that is guaranteed dead: spawnSync returns only after the child exits.
function deadPid() {
  const d = spawnSync(process.execPath, ["-e", ""]);
  assert.ok(d.pid, "expected a pid for the throwaway process");
  return d.pid;
}

describe("dispatch-wait.sh", () => {
  it("script exists and is syntactically valid bash", () => {
    assert.ok(fs.existsSync(scriptPath), "scripts/dispatch-wait.sh must exist");
    execFileSync("bash", ["-n", scriptPath]);
  });

  // DONE: valid result.json → state=done with the parsed result nested.
  it("reports done and nests the result when result.json exists and is valid", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-wait-done-"));
    try {
      const resultFile = path.join(tmp, "result.json");
      const result = {
        status: "merged",
        issue_id: "PM-1.1",
        pr: 1067,
        merge_sha: "abc",
        files_changed: 31,
      };
      fs.writeFileSync(resultFile, JSON.stringify(result) + "\n");
      fs.writeFileSync(path.join(tmp, "dispatch.pid"), String(process.pid) + "\n");

      const parsed = runWait([
        "--result-file",
        resultFile,
        "--timeout",
        "1",
        "--interval",
        "1",
        "--reparse-delay",
        "0",
      ]);
      assert.equal(parsed.state, "done");
      assert.deepEqual(parsed.result, result, "done must nest the parsed result.json");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  // CRASHED: dead pid + no result = SIGKILL/trap-bypass.
  it("reports crashed when the pid is dead and no result was written", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-wait-crash-"));
    try {
      const resultFile = path.join(tmp, "result.json");
      fs.writeFileSync(path.join(tmp, "dispatch.pid"), String(deadPid()) + "\n");
      assert.ok(!fs.existsSync(resultFile), "precondition: no result file");

      const parsed = runWait([
        "--result-file",
        resultFile,
        "--timeout",
        "5",
        "--interval",
        "1",
        "--reparse-delay",
        "0",
      ]);
      assert.equal(parsed.state, "crashed");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  // RUNNING: alive dispatcher (identity matches), no result, ceiling elapsed.
  it("reports running when an actual dispatcher is alive and the ceiling elapses", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-wait-run-"));
    const child = spawnOursAlive();
    try {
      const resultFile = path.join(tmp, "result.json");
      fs.writeFileSync(path.join(tmp, "dispatch.pid"), String(child.pid) + "\n");

      const parsed = runWait([
        "--result-file",
        resultFile,
        "--timeout",
        "1",
        "--interval",
        "1",
        "--reparse-delay",
        "0",
      ]);
      assert.equal(parsed.state, "running");
      assert.ok(!fs.existsSync(resultFile), "running must not fabricate a result");
    } finally {
      child.kill("SIGKILL");
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  // Fix 1 — empty result.json (the mid-write race window) must fail closed as
  // crashed, NOT parse as done, on BOTH validators.
  it("reports crashed for an empty result.json under jq and node (fail closed)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-wait-empty-"));
    try {
      const resultFile = path.join(tmp, "result.json");
      fs.writeFileSync(resultFile, "");
      for (const tool of ["jq", "node", "auto"]) {
        const parsed = runWait([
          "--result-file",
          resultFile,
          "--timeout",
          "1",
          "--interval",
          "1",
          "--reparse-delay",
          "0",
          "--json-tool",
          tool,
        ]);
        assert.equal(
          parsed.state,
          "crashed",
          `empty result.json must be crashed under --json-tool ${tool}`
        );
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  // Fix 1 — multiple JSON docs concatenated must fail closed on BOTH validators
  // (the old jq `.` printed two lines and one doc slipped through as done).
  it("reports crashed for a multi-document result.json under jq and node", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-wait-multi-"));
    try {
      const resultFile = path.join(tmp, "result.json");
      fs.writeFileSync(resultFile, '{"a":1}\n{"b":2}\n');
      for (const tool of ["jq", "node", "auto"]) {
        const parsed = runWait([
          "--result-file",
          resultFile,
          "--timeout",
          "1",
          "--interval",
          "1",
          "--reparse-delay",
          "0",
          "--json-tool",
          tool,
        ]);
        assert.equal(
          parsed.state,
          "crashed",
          `multi-doc result.json must be crashed under --json-tool ${tool}`
        );
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  // Existing malformed case still fails closed.
  it("reports crashed when result.json exists but is malformed (fail closed)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-wait-malformed-"));
    try {
      const resultFile = path.join(tmp, "result.json");
      fs.writeFileSync(resultFile, "{ status: not json, truncated");
      const parsed = runWait([
        "--result-file",
        resultFile,
        "--timeout",
        "1",
        "--interval",
        "1",
        "--reparse-delay",
        "0",
      ]);
      assert.equal(parsed.state, "crashed");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  // Fix 2 — dispatch never started (bad args / CLI-not-found exit before the
  // pid file is written). Missing pid file after a FULL ceiling must be crashed,
  // not an infinite "running" heartbeat.
  it("reports crashed when the pid file never appears after a full ceiling", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-wait-nostart-"));
    try {
      const resultFile = path.join(tmp, "result.json");
      // No dispatch.pid, no result.json.
      const parsed = runWait([
        "--result-file",
        resultFile,
        "--timeout",
        "1",
        "--interval",
        "1",
        "--reparse-delay",
        "0",
      ]);
      assert.equal(parsed.state, "crashed");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  // Fix 3 — an empty/incomplete pid file (transient write) must NOT spuriously
  // crash; it is indeterminate, so keep waiting (running).
  it("reports running (not crashed) for an empty pid file with no result", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-wait-emptypid-"));
    try {
      const resultFile = path.join(tmp, "result.json");
      fs.writeFileSync(path.join(tmp, "dispatch.pid"), "");
      const parsed = runWait([
        "--result-file",
        resultFile,
        "--timeout",
        "1",
        "--interval",
        "1",
        "--reparse-delay",
        "0",
      ]);
      assert.equal(parsed.state, "running");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  // Fix 3 — a recycled PID: the pid file points at a live process that is NOT
  // the dispatcher. kill -0 succeeds but identity fails → crashed, not a forever
  // "running".
  it("reports crashed when the pid was recycled to an unrelated live process", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-wait-recycled-"));
    const child = spawnUnrelatedAlive();
    try {
      const resultFile = path.join(tmp, "result.json");
      fs.writeFileSync(path.join(tmp, "dispatch.pid"), String(child.pid) + "\n");
      const parsed = runWait([
        "--result-file",
        resultFile,
        "--timeout",
        "1",
        "--interval",
        "1",
        "--reparse-delay",
        "0",
      ]);
      assert.equal(parsed.state, "crashed");
    } finally {
      child.kill("SIGKILL");
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  // Fix 4 — a result.json caught mid-write must not halt the epic: on parse
  // failure the helper waits --reparse-delay and re-parses once. Here the writer
  // completes the file within the window, so the verdict is done.
  it("re-parses once after a mid-write and reports done when the write completes", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-wait-midwrite-"));
    const resultFile = path.join(tmp, "result.json");
    // Starts malformed (a partial write), completed by a delayed writer.
    fs.writeFileSync(resultFile, '{"status":"mer');
    const writer = spawn(
      process.execPath,
      [
        "-e",
        `setTimeout(() => require("fs").writeFileSync(${JSON.stringify(resultFile)}, JSON.stringify({status:"merged",pr:9})), 800)`,
      ],
      { stdio: "ignore" }
    );
    try {
      const parsed = runWait([
        "--result-file",
        resultFile,
        "--timeout",
        "2",
        "--interval",
        "1",
        "--reparse-delay",
        "2",
      ]);
      assert.equal(parsed.state, "done");
      assert.equal(parsed.result.status, "merged");
    } finally {
      writer.kill("SIGKILL");
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  // Fix 6 — pin the DEFAULT ceiling on the actual assignment, not the usage text
  // (which would keep a stale /\b900\b/ green if the default changed).
  it("pins the 900s default on the TIMEOUT assignment", () => {
    const src = fs.readFileSync(scriptPath, "utf8");
    assert.match(src, /^TIMEOUT=900$/m, "helper's default ceiling must be TIMEOUT=900");
  });
});
