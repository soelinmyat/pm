#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { stableObjectHmac, withoutAuthentication } = require("./lib/stable-authentication");
const { sharedObjectIdentities } = require("./lib/verification-runtime");
const { digest } = require("./lib/repository-gate-plan-schema");
const {
  readProjectInput,
  writeProjectJsonAtomic,
  acquireProjectWriteLock,
} = require("./lib/project-file");

const OUTPUT_LIMIT = 1024 * 1024;
const FILE_LIMIT = 16 * 1024 * 1024;
const TREE_LIMIT = 256 * 1024 * 1024;
const FILE_COUNT = 20000;
const CONTRACT_FIELDS = [
  "schema_version",
  "kind",
  "root",
  "executable",
  "args",
  "environment",
  "input_contract",
  "timeout_ms",
  "max_age_ms",
  "authentication",
];
const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
function authentic(value, key) {
  const expected = stableObjectHmac(value, key);
  const actual = value?.authentication;
  return (
    typeof actual === "string" &&
    expected !== null &&
    actual.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
  );
}
function validateContract(contract, key) {
  if (
    !contract ||
    Object.keys(contract).some((name) => !CONTRACT_FIELDS.includes(name)) ||
    !authentic(contract, key) ||
    contract.schema_version !== 1 ||
    contract.kind !== "verification-execution-contract" ||
    contract.input_contract !== "deterministic-workspace-only-v1"
  )
    throw new Error("authenticated deterministic workspace-only execution contract required");
  if (
    !path.isAbsolute(contract.root || "") ||
    !path.isAbsolute(contract.executable || "") ||
    !Array.isArray(contract.args) ||
    !contract.args.length ||
    contract.args.length > 256 ||
    contract.args.some(
      (arg) => typeof arg !== "string" || arg.length > 4000 || arg.includes("\0")
    ) ||
    !contract.environment ||
    typeof contract.environment !== "object" ||
    Array.isArray(contract.environment) ||
    Object.keys(contract.environment).length > 128 ||
    Object.entries(contract.environment).some(
      ([name, value]) =>
        !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ||
        /^PM_.*(?:KEY|SECRET)$/.test(name) ||
        typeof value !== "string" ||
        value.length > 16384 ||
        value.includes("\0")
    ) ||
    !Number.isInteger(contract.timeout_ms) ||
    contract.timeout_ms < 1 ||
    contract.timeout_ms > 3600000 ||
    !Number.isInteger(contract.max_age_ms) ||
    contract.max_age_ms < 1 ||
    contract.max_age_ms > 3600000
  )
    throw new Error("invalid execution contract");
}

// Inventory everything, including ignored/generated inputs and installed dependency
// bytes. There is deliberately no caller-controlled exclusion list. Unsupported
// files or budget exhaustion disable reuse rather than becoming an empty identity.
function workspaceIdentity(root) {
  let bytes = 0,
    count = 0;
  const h = crypto.createHash("sha256");
  function visit(relative) {
    const file = path.join(root, relative);
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) throw new Error("unknown symlink input");
    if (stat.isDirectory()) {
      h.update(
        JSON.stringify([
          relative,
          "directory",
          stat.mode,
          stat.uid,
          stat.gid,
          stat.mtimeMs,
          stat.ctimeMs,
        ])
      );
      for (const name of fs.readdirSync(file).sort()) visit(path.join(relative, name));
    } else {
      if (
        !stat.isFile() ||
        stat.size > FILE_LIMIT ||
        ++count > FILE_COUNT ||
        (bytes += stat.size) > TREE_LIMIT
      )
        throw new Error("unknown or over-budget input");
      // Worktree .git pointers introduce inputs outside this workspace. Ordinary
      // .git directories are inventoried in full; pointer checkouts execute fresh.
      if (relative === ".git") throw new Error("external git metadata");
      const data = readProjectInput(root, relative, FILE_LIMIT).bytes;
      const after = fs.lstatSync(file);
      if (
        stat.ino !== after.ino ||
        stat.size !== after.size ||
        stat.mtimeMs !== after.mtimeMs ||
        stat.ctimeMs !== after.ctimeMs
      )
        throw new Error("input changed during observation");
      h.update(
        JSON.stringify([relative, stat.mode, stat.size, stat.mtimeMs, stat.ctimeMs, hash(data)])
      );
    }
  }
  try {
    visit("");
    return h.digest("hex");
  } catch {
    return null;
  }
}
function observeIdentity(contract) {
  const root = fs.realpathSync(contract.root);
  const executable = fs.realpathSync(contract.executable);
  const stat = fs.statSync(executable);
  if (!stat.isFile() || stat.size > 256 * 1024 * 1024)
    throw new Error("runtime identity unavailable");
  if (executable !== fs.realpathSync(process.execPath))
    throw new Error("only the owning Node runtime is supported");
  const source = workspaceIdentity(root);
  const runner = workspaceIdentity(__dirname);
  let sharedObjects;
  try {
    sharedObjects = sharedObjectIdentities(process.report.getReport());
  } catch {
    return null;
  }
  return (
    source &&
    runner &&
    digest({
      contract: withoutAuthentication(contract),
      root,
      source,
      executable,
      runtime_bytes: hash(fs.readFileSync(executable)),
      owner_arguments: process.execArgv,
      owner_bootstrap: Object.fromEntries(
        ["NODE_OPTIONS", "NODE_PATH", "NODE_V8_COVERAGE", "OPENSSL_CONF", "TZ", "LANG"].map(
          (name) => [name, process.env[name] ?? null]
        )
      ),
      runner_bytes: runner,
      shared_objects: sharedObjects,
      host: {
        platform: process.platform,
        arch: process.arch,
        release: os.release(),
        version: os.version(),
        hostname: os.hostname(),
        uid: process.getuid?.() ?? null,
        gid: process.getgid?.() ?? null,
        groups: process.getgroups?.().sort((a, b) => a - b) ?? null,
        umask: process.umask(),
        node: process.version,
        versions: process.versions,
      },
    })
  );
}
function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
}
function executeBounded(contract, root) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(contract.executable, contract.args, {
        cwd: root,
        // Node implicitly copies parent coverage into an env object unless it
        // has this own property. Keep undeclared coverage absent in the child,
        // and never give spawn the authenticated contract object to mutate.
        env: { NODE_V8_COVERAGE: undefined, ...contract.environment },
        shell: false,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({ error, status: null });
      return;
    }
    const output = { stdout: [], stderr: [] };
    let bytes = 0,
      error = null,
      settled = false;
    const terminate = (code) => {
      error ||= Object.assign(new Error(code), { code });
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        /* Already exited. */
      }
      child.stdout.destroy();
      child.stderr.destroy();
      finish(null, "SIGKILL");
    };
    const timer = setTimeout(() => terminate("ETIMEDOUT"), contract.timeout_ms);
    const finish = (status, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        status,
        signal,
        error,
        stdout: Buffer.concat(output.stdout).toString("utf8"),
        stderr: Buffer.concat(output.stderr).toString("utf8"),
      });
    };
    for (const stream of ["stdout", "stderr"])
      child[stream].on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > OUTPUT_LIMIT) terminate("ENOBUFS");
        else output[stream].push(chunk);
      });
    child.on("error", (cause) => {
      error = cause;
      terminate(cause.code || "EXECUTION_ERROR");
    });
    child.on("close", (status, signal) => {
      if (settled) return;
      // Terminate descendants even if the suite's direct process already exited.
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        /* Group is gone. */
      }
      finish(status, signal);
    });
  });
}
async function runVerification(contract, { key, store, stage = "baseline" } = {}) {
  if (process.platform === "win32")
    throw new Error("execution receipts require POSIX process-group termination");
  validateContract(contract, key);
  if (!["baseline", "final"].includes(stage)) throw new Error("stage must be baseline or final");
  const root = fs.realpathSync(contract.root);
  const evidenceRoot = fs.realpathSync(store);
  if (isInside(root, evidenceRoot) || isInside(evidenceRoot, root))
    throw new Error("receipt store must be separate from all workspace inputs");
  const release = acquireProjectWriteLock(evidenceRoot, "execution", { attempts: 1 });
  try {
    const before = observeIdentity(contract);
    const cachePath = before && `passed/${before.slice(7)}.json`;
    if (cachePath && stage !== "final") {
      try {
        const receipt = JSON.parse(
          readProjectInput(evidenceRoot, cachePath, 4 * OUTPUT_LIMIT).bytes
        );
        const age = Date.now() - Date.parse(receipt.finished_at);
        if (
          authentic(receipt, key) &&
          receipt.schema_version === 1 &&
          receipt.kind === "verification-execution-receipt" &&
          receipt.identity === before &&
          receipt.exit_code === 0 &&
          receipt.reusable === true &&
          receipt.outcome === "passed" &&
          receipt.signal === null &&
          typeof receipt.stdout === "string" &&
          typeof receipt.stderr === "string" &&
          age >= 0 &&
          age <= contract.max_age_ms &&
          observeIdentity(contract) === before
        )
          return {
            status: "passed",
            exit_code: 0,
            reused: true,
            receipt: cachePath,
            identity: before,
          };
      } catch {
        /* Missing, malformed, forged or unreadable evidence executes fresh. */
      }
    }
    const started = new Date().toISOString();
    const result = await executeBounded(contract, root);
    const after = observeIdentity(contract);
    const passed = !result.error && result.status === 0 && !result.signal;
    const reusable = passed && before !== null && before === after;
    const receipt = {
      schema_version: 1,
      kind: "verification-execution-receipt",
      identity: reusable ? before : null,
      started_at: started,
      finished_at: new Date().toISOString(),
      exit_code: result.status ?? 1,
      signal: result.signal || null,
      stdout: String(result.stdout || ""),
      stderr: String(result.stderr || ""),
      reusable,
      outcome: passed ? "passed" : "failed",
      diagnostic: result.error
        ? result.error.code || "execution-error"
        : before === null
          ? "unknown-inputs"
          : before !== after
            ? "input-drift"
            : null,
    };
    receipt.authentication = stableObjectHmac(receipt, key);
    const attempt = `attempts/${crypto.randomUUID()}.json`;
    writeProjectJsonAtomic(evidenceRoot, attempt, receipt, {
      fileMode: 0o600,
      directoryMode: 0o700,
    });
    if (reusable)
      writeProjectJsonAtomic(evidenceRoot, cachePath, receipt, {
        replace: true,
        fileMode: 0o600,
        directoryMode: 0o700,
      });
    return {
      status: passed ? "passed" : "failed",
      exit_code: passed ? 0 : result.status || 1,
      reused: false,
      reusable,
      receipt: attempt,
      identity: reusable ? before : null,
      diagnostic: receipt.diagnostic,
    };
  } finally {
    release();
  }
}
async function main(argv = process.argv.slice(2)) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!["--contract", "--store", "--stage"].includes(argv[i]) || !argv[i + 1])
      throw new Error("use --contract PATH --store DIRECTORY [--stage baseline|final]");
    args[argv[i].slice(2)] = argv[i + 1];
  }
  if (!args.contract || !args.store)
    throw new Error("contract and existing external receipt store are required");
  const contract = JSON.parse(fs.readFileSync(args.contract, "utf8"));
  const result = await runVerification(contract, {
    store: args.store,
    stage: args.stage,
    key: process.env.PM_VERIFICATION_RECEIPT_KEY,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.exit_code;
}
if (require.main === module) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}
module.exports = { runVerification, workspaceIdentity };
