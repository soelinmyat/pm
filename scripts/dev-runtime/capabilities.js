const { execFileSync } = require("node:child_process");

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
  return detectCapabilities(provider, {
    version,
    help: run(runner, command, helpArgs),
    resumeHelp: run(runner, command, resumeArgs),
  });
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

module.exports = { detectCapabilities, probeCapabilities, requireCapabilities };
