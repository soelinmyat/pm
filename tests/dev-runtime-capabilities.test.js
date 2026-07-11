const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const {
  detectCapabilities,
  acquireProbeLock,
  probeCapabilities,
  probeCapabilitiesCached,
  requireCapabilities,
} = require("../scripts/dev-runtime/capabilities");

describe("dev runtime capability detection", () => {
  it("detects current Codex structured output, JSONL, containment, and resume", () => {
    const capabilities = detectCapabilities("codex", {
      help: "--sandbox --json --output-schema --output-last-message",
      resumeHelp: "codex exec resume --json --output-schema",
      version: "codex-cli 0.144.0-alpha.4",
    });
    assert.equal(capabilities.structuredOutput, true);
    assert.equal(capabilities.eventStream, true);
    assert.equal(capabilities.resume, true);
    assert.equal(capabilities.safePermissions, true);
  });

  it("fails closed instead of silently downgrading required capabilities", () => {
    const oldClaude = detectCapabilities("claude", {
      help: "--model --print",
      resumeHelp: "",
      version: "1.0.0",
    });
    assert.throws(
      () => requireCapabilities(oldClaude, ["structuredOutput", "eventStream", "safePermissions"]),
      /missing required capabilities/
    );
  });

  it("probes Claude help once and reuses the result for resume detection", () => {
    const calls = [];
    const runner = (_command, args) => {
      calls.push(args.join(" "));
      if (args.includes("--version")) return "2.1.207";
      return "--json-schema stream-json --resume --permission-mode auto";
    };
    const capabilities = probeCapabilities("claude", runner);
    assert.equal(capabilities.resume, true);
    assert.deepEqual(calls, ["--version", "--help"]);
  });

  it("caches capability probes by executable fingerprint", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-capabilities-"));
    try {
      const executable = path.join(dir, "codex");
      fs.writeFileSync(executable, "#!/bin/sh\n");
      fs.chmodSync(executable, 0o755);
      let calls = 0;
      const runner = (_command, args) => {
        calls += 1;
        if (args.includes("--version")) return "codex-cli 1";
        if (args.includes("resume")) return "exec resume --output-schema";
        return "--sandbox --json --output-schema --output-last-message";
      };
      const options = { executable, cacheDir: path.join(dir, "cache"), runner };
      const first = probeCapabilitiesCached("codex", options);
      const second = probeCapabilitiesCached("codex", options);
      assert.deepEqual(second, first);
      assert.equal(calls, 3);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("serializes parallel cold probes and publishes the cache atomically", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-capabilities-parallel-"));
    try {
      const executable = path.join(dir, "codex");
      const counter = path.join(dir, "calls.log");
      const cacheDir = path.join(dir, "cache");
      fs.writeFileSync(
        executable,
        [
          "#!/bin/sh",
          `printf 'x\\n' >> ${JSON.stringify(counter)}`,
          "sleep 0.05",
          'case "$*" in',
          '  *--version*) echo "codex-cli 1" ;;',
          '  *resume*) echo "exec resume --output-schema" ;;',
          '  *) echo "--sandbox --json --output-schema --output-last-message" ;;',
          "esac",
        ].join("\n")
      );
      fs.chmodSync(executable, 0o755);
      const modulePath = require.resolve("../scripts/dev-runtime/capabilities");
      const source = `require(${JSON.stringify(modulePath)}).probeCapabilitiesCached("codex", { executable: ${JSON.stringify(executable)}, cacheDir: ${JSON.stringify(cacheDir)} });`;
      const env = { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}` };
      await Promise.all([runNode(source, env), runNode(source, env)]);
      assert.equal(fs.readFileSync(counter, "utf8").trim().split("\n").length, 3);
      assert.deepEqual(
        fs.readdirSync(cacheDir).filter((name) => name.includes(".tmp-") || name.endsWith(".lock")),
        []
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reclaims an abandoned lock directory after the initialization grace", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-capabilities-lock-"));
    const lockPath = path.join(dir, "probe.lock");
    try {
      fs.mkdirSync(lockPath);
      const release = acquireProbeLock(lockPath, () => null, {
        initializationGraceMs: 0,
        lockAttempts: 2,
        lockWaitMs: 0,
      });
      assert.ok(fs.existsSync(path.join(lockPath, "owner.json")));
      release();
      assert.equal(fs.existsSync(lockPath), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

function runNode(source, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", source], { env, stdio: "pipe" });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`child exited ${code}: ${stderr}`))
    );
  });
}
