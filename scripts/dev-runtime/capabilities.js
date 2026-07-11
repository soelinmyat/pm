const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

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
  try {
    const cached = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    if (cached.provider === provider && cached.fingerprint === fingerprint)
      return cached.capabilities;
  } catch {
    // A missing or invalid cache is replaced from a fresh probe.
  }
  const capabilities = probeCapabilities(provider, options.runner || execFileSync);
  fs.mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(
    cachePath,
    `${JSON.stringify({ provider, fingerprint, capabilities }, null, 2)}\n`,
    { mode: 0o600 }
  );
  fs.chmodSync(cachePath, 0o600);
  return capabilities;
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
  probeCapabilities,
  probeCapabilitiesCached,
  requireCapabilities,
};
