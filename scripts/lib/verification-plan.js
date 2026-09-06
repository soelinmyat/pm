"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { readProjectInput } = require("./project-file");
const { gitExec } = require("./git-env");
const LIMIT = 16 * 1024 * 1024;
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");

function sourceIdentity(root) {
  const names = [
    ...new Set(
      gitExec(root, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
        .split("\0")
        .filter(Boolean)
    ),
  ].sort();
  if (names.length > 20_000) throw new Error("verification source inventory exceeds budget");
  const digest = crypto.createHash("sha256");
  for (const name of names) {
    digest.update(JSON.stringify(name));
    try {
      const stat = fs.lstatSync(path.join(root, name));
      // Symlinks/submodules may depend on content outside this inventory.
      // Keep planning possible, but require execution instead of reuse.
      if (!stat.isFile()) return null;
      digest.update(String(stat.mode));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    try {
      digest.update(hash(readProjectInput(root, name, LIMIT).bytes));
    } catch (error) {
      if (error.code === "ENOENT" || /ENOENT/.test(error.message)) digest.update("<deleted>");
      else throw error;
    }
  }
  return digest.digest("hex");
}

function buildVerificationPlan(
  input,
  { root = process.cwd(), evidenceRoot = root, prior = [] } = {}
) {
  if (
    !["low", "medium", "high"].includes(input?.risk) ||
    typeof input.executable_change !== "boolean" ||
    !["baseline", "final"].includes(input.stage)
  )
    throw new Error("plan requires risk, executable_change, and baseline/final stage");
  if (!Array.isArray(prior)) throw new Error("prior receipts must be an array");
  const commands = new Map();
  for (const [field, mandatory] of [
    ["repository_commands", true],
    ["focused_commands", false],
  ]) {
    if (!Array.isArray(input[field])) throw new Error(`${field} must be an array`);
    for (const command of input[field]) {
      if (typeof command !== "string" || !command.trim() || command.length > 4000)
        throw new Error("verification command must be bounded text");
      if (mandatory || input.executable_change || input.risk !== "low")
        commands.set(command, Boolean(commands.get(command)) || mandatory);
    }
  }
  if (commands.size === 0 && (input.executable_change || input.risk !== "low"))
    throw new Error("executable or elevated-risk work requires at least one verification command");
  // Missing dependency/environment identity disables reuse; it never becomes
  // an empty identity that could accidentally match another unknown runtime.
  const source = sourceIdentity(root);
  const known =
    source !== null &&
    [input.environment, input.dependencies].every(
      (value) =>
        value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0
    );
  const identities = {
    source,
    environment: known
      ? hash(
          JSON.stringify({
            workspace: path.resolve(root),
            platform: process.platform,
            arch: process.arch,
            node: process.version,
            executable: process.execPath,
            supplied: input.environment,
          })
        )
      : null,
    dependencies: known ? hash(JSON.stringify(input.dependencies)) : null,
  };
  const checks = [...commands].map(([command, mandatory]) => {
    const key = known ? hash(JSON.stringify({ command, ...identities })) : null;
    const receipt = key && prior.find((item) => item?.key === key && item.status === "passed");
    let retained = false;
    if (receipt?.artifact?.path && /^[a-f0-9]{64}$/.test(receipt.artifact.sha256 || "")) {
      try {
        retained =
          hash(readProjectInput(evidenceRoot, receipt.artifact.path, LIMIT).bytes) ===
          receipt.artifact.sha256;
      } catch {
        retained = false;
      }
    }
    const reuse = retained && !(mandatory && input.stage === "final");
    return {
      command,
      mandatory,
      key,
      action: reuse ? "reuse" : "run",
      reason:
        mandatory && input.stage === "final"
          ? "repository-mandated final check"
          : reuse
            ? "current inputs and retained passing output match"
            : "new, changed, or unknown inputs",
      ...(reuse ? { receipt } : {}),
    };
  });
  return {
    schema_version: 1,
    kind: "verification-plan",
    stage: input.stage,
    risk: input.risk,
    executable_change: input.executable_change,
    identities,
    checks,
    certification: "planning-only; existing final gate requirements still apply",
  };
}

function main(argv = process.argv.slice(2)) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (
      !["--root", "--evidence-root", "--input", "--out", "--prior"].includes(argv[i]) ||
      !argv[i + 1]
    )
      throw new Error("use --root --input --out [--prior] [--evidence-root]");
    args[argv[i].slice(2)] = argv[i + 1];
  }
  if (!args.input || !args.out) throw new Error("--input and --out are required");
  const root = path.resolve(args.root || process.cwd());
  const evidenceRoot = path.resolve(args["evidence-root"] || root);
  const read = (name) => JSON.parse(readProjectInput(evidenceRoot, name, LIMIT).bytes);
  const result = buildVerificationPlan(read(args.input), {
    root,
    evidenceRoot,
    prior: args.prior ? read(args.prior) : [],
  });
  require("./project-file").writeProjectJsonAtomic(evidenceRoot, args.out, result, {
    replace: true,
    fileMode: 0o600,
    directoryMode: 0o700,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return 0;
}
if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
module.exports = { buildVerificationPlan, sourceIdentity, main };
