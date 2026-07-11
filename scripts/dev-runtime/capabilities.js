const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { writeJsonAtomic } = require("../lib/atomic-file");

function detectCapabilities(provider, { help = "", resumeHelp = "", version = "" } = {}) {
  if (provider === "codex") {
    return {
      provider,
      version: version.trim(),
      structuredOutput: hasAll(help, ["--output-schema", "--output-last-message"]),
      eventStream: help.includes("--json"),
      resume: resumeHelp.includes("exec resume") && resumeHelp.includes("--output-schema"),
      safePermissions: help.includes("--sandbox"),
    };
  }
  if (provider === "claude") {
    return {
      provider,
      version: version.trim(),
      structuredOutput: help.includes("--json-schema"),
      eventStream: help.includes("stream-json"),
      resume: help.includes("--resume"),
      safePermissions: help.includes("--permission-mode") && help.includes("auto"),
    };
  }
  if (provider === "inline") {
    return {
      provider,
      version: "interactive",
      structuredOutput: true,
      eventStream: false,
      resume: true,
      safePermissions: true,
    };
  }
  throw new Error(`unsupported provider: ${provider}`);
}

function probeCapabilities(provider, runner = execFileSync) {
  const command = provider === "claude" ? "claude" : "codex";
  const version = run(runner, command, ["--version"]);
  const helpArgs = provider === "claude" ? ["--help"] : ["exec", "--help"];
  const resumeArgs = provider === "claude" ? ["--help"] : ["exec", "resume", "--help"];
  const help = run(runner, command, helpArgs);
  return detectCapabilities(provider, {
    version,
    help,
    resumeHelp: provider === "claude" ? help : run(runner, command, resumeArgs),
  });
}

function probeCapabilitiesCached(provider, options = {}) {
  const executable =
    options.executable || findExecutable(provider === "claude" ? "claude" : "codex");
  if (!executable) {
    const error = new Error(`${provider} CLI not in PATH`);
    error.code = "ENOENT";
    throw error;
  }
  const stat = fs.statSync(executable);
  const fingerprint = crypto
    .createHash("sha256")
    .update(`${fs.realpathSync(executable)}\0${stat.size}\0${stat.mtimeMs}`)
    .digest("hex")
    .slice(0, 20);
  const cacheDir =
    options.cacheDir ||
    path.join(os.tmpdir(), `pm-dev-capabilities-${process.getuid?.() ?? "user"}`);
  const cachePath = path.join(cacheDir, `${provider}-${fingerprint}.json`);
  fs.mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
  const readCached = () => readCapabilityCache(cachePath, provider, fingerprint);
  const cached = readCached();
  if (cached) return cached;

  const release = acquireProbeLock(`${cachePath}.lock`, readCached, options);
  if (release.cached) return release.cached;
  try {
    const afterLock = readCached();
    if (afterLock) return afterLock;
    const capabilities = probeCapabilities(provider, options.runner || execFileSync);
    writeJsonAtomic(
      cachePath,
      { provider, fingerprint, capabilities },
      {
        directoryMode: 0o700,
        fileMode: 0o600,
      }
    );
    return capabilities;
  } finally {
    release();
  }
}

function readCapabilityCache(cachePath, provider, fingerprint) {
  try {
    const cached = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    return cached.provider === provider && cached.fingerprint === fingerprint
      ? cached.capabilities
      : null;
  } catch {
    return null;
  }
}

function acquireProbeLock(lockPath, readCached, options = {}) {
  const attempts = options.lockAttempts ?? 200;
  const waitMs = options.lockWaitMs ?? 25;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const token = crypto.randomBytes(16).toString("hex");
    const candidatePath = `${lockPath}.candidate-${process.pid}-${token}`;
    try {
      writeJsonAtomic(
        candidatePath,
        { pid: process.pid, token, created_at: new Date().toISOString() },
        { directoryMode: 0o700, fileMode: 0o600 }
      );
      fs.linkSync(candidatePath, lockPath);
      fs.rmSync(candidatePath, { force: true });
      const release = () => releaseProbeLock(lockPath, token);
      release.cached = null;
      return release;
    } catch (error) {
      fs.rmSync(candidatePath, { force: true });
      if (error.code !== "EEXIST") throw error;
      const cached = readCached();
      if (cached) {
        const release = () => {};
        release.cached = cached;
        return release;
      }
      if (reclaimStaleProbeLock(lockPath, options)) {
        continue;
      }
      synchronousWait(waitMs);
    }
  }
  throw new Error(`timed out waiting for capability probe lock: ${lockPath}`);
}

function releaseProbeLock(lockPath, token) {
  try {
    if (readProbeOwner(lockPath).token === token) fs.rmSync(lockPath, { force: true });
  } catch {
    // The lock was already reclaimed or released.
  }
}

function reclaimStaleProbeLock(lockPath, options) {
  const invalidGraceMs = options.invalidLockGraceMs ?? 1000;
  let observed;
  try {
    observed = readProbeOwner(lockPath);
    try {
      process.kill(observed.pid, 0);
      return false;
    } catch (error) {
      if (error.code !== "ESRCH") return false;
    }
  } catch {
    try {
      if (Date.now() - fs.statSync(lockPath).mtimeMs < invalidGraceMs) return false;
      observed = { token: null };
    } catch {
      return false;
    }
  }
  options.beforeReclaimRename?.({ lockPath, observed: structuredClone(observed) });
  const quarantine = `${lockPath}.stale-${process.pid}-${crypto.randomBytes(8).toString("hex")}`;
  try {
    fs.renameSync(lockPath, quarantine);
  } catch {
    return false;
  }
  try {
    const moved = readProbeOwner(quarantine);
    if (!observed.token || moved.token !== observed.token) {
      try {
        fs.renameSync(quarantine, lockPath);
      } catch {
        // A newer owner already restored the fixed lock path.
      }
      return false;
    }
  } catch {
    if (observed.token) return false;
  }
  fs.rmSync(quarantine, { recursive: true, force: true });
  return true;
}

function readProbeOwner(lockPath) {
  const owner = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  if (
    !Number.isInteger(owner.pid) ||
    owner.pid < 1 ||
    typeof owner.token !== "string" ||
    !owner.token
  ) {
    throw new Error("invalid capability lock owner");
  }
  return owner;
}

function synchronousWait(ms) {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function findExecutable(command, envPath = process.env.PATH || "") {
  for (const directory of envPath.split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, command);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // Continue searching PATH.
    }
  }
  return null;
}

function requireCapabilities(capabilities, required) {
  const missing = required.filter((name) => !capabilities[name]);
  if (missing.length > 0) {
    throw new Error(
      `${capabilities.provider} is missing required capabilities: ${missing.join(", ")}`
    );
  }
  return capabilities;
}

function run(runner, command, args) {
  return runner(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function hasAll(value, needles) {
  return needles.every((needle) => value.includes(needle));
}

module.exports = {
  detectCapabilities,
  findExecutable,
  acquireProbeLock,
  probeCapabilities,
  probeCapabilitiesCached,
  requireCapabilities,
};
