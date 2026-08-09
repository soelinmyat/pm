#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");
const { discoverRepositoryCapabilities } = require("./lib/repository-capabilities");
const { digest, planMaterial } = require("./lib/repository-gate-plan-schema");

function globToRegex(glob) {
  let source = "",
    i = 0;
  while (i < glob.length) {
    if (glob.slice(i, i + 3) === "**/") {
      source += "(?:.*/)?";
      i += 3;
      continue;
    }
    if (glob.slice(i, i + 2) === "**") {
      source += ".*";
      i += 2;
      continue;
    }
    if (glob[i] === "*") {
      source += "[^/]*";
      i++;
      continue;
    }
    if (glob[i] === "?") {
      source += "[^/]";
      i++;
      continue;
    }
    if (glob[i] === "{") {
      const end = glob.indexOf("}", i);
      if (end > i) {
        source += `(?:${glob
          .slice(i + 1, end)
          .split(",")
          .map((x) => x.replace(/[.+^$()|[\]\\]/g, "\\$&"))
          .join("|")})`;
        i = end + 1;
        continue;
      }
    }
    source += glob[i].replace(/[.+^$()|[\]\\]/g, "\\$&");
    i++;
  }
  return new RegExp(`^${source}$`);
}

function matches(command, changedPath) {
  const globs = Array.isArray(command.glob)
    ? command.glob
    : String(command.glob || "**/*")
        .split(/\s+/)
        .filter(Boolean);
  const excludes = Array.isArray(command.exclude)
    ? command.exclude
    : command.exclude
      ? String(command.exclude).split(/\s+/).filter(Boolean)
      : [];
  return (
    globs.some((glob) => globToRegex(glob).test(changedPath)) &&
    !excludes.some((glob) => globToRegex(glob).test(changedPath))
  );
}

const SHA_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

function validRef(ref) {
  if (
    typeof ref !== "string" ||
    !ref.startsWith("refs/") ||
    ref.endsWith("/") ||
    ref.includes("//") ||
    ref.includes("..") ||
    ref.includes("@{")
  )
    return false;
  return ref
    .split("/")
    .every(
      (part, index) =>
        index === 0 ||
        (part &&
          !part.startsWith(".") &&
          !part.endsWith(".") &&
          !part.endsWith(".lock") &&
          /^[A-Za-z0-9._-]+$/.test(part))
    );
}

function validateGitPushInputs(remote, remoteUrl, refUpdates) {
  if (remote !== null && remote !== undefined && !/^[A-Za-z0-9._-]+$/.test(remote))
    throw new Error("invalid Git remote name");
  if (
    remoteUrl !== null &&
    remoteUrl !== undefined &&
    (typeof remoteUrl !== "string" ||
      !remoteUrl ||
      remoteUrl.startsWith("-") ||
      remoteUrl.length > 2048 ||
      /[\0\r\n]/.test(remoteUrl))
  )
    throw new Error("invalid Git remote URL");
  if (!Array.isArray(refUpdates)) throw new Error("Git ref updates must be an array");
  for (const line of refUpdates) {
    if (typeof line !== "string" || /[\r\n\0]/.test(line))
      throw new Error("invalid Git ref-update line");
    const fields = line.split(" ");
    if (fields.length !== 4 || fields.some((field) => !field))
      throw new Error("Git ref update requires exactly four fields");
    if (!validRef(fields[0]) || !validRef(fields[2])) throw new Error("invalid Git ref name");
    if (!SHA_RE.test(fields[1]) || !SHA_RE.test(fields[3])) throw new Error("invalid Git SHA");
  }
  return true;
}

function buildDeliveryPlan(input) {
  const capabilities = input.capabilities || {},
    commands = input.commands || {},
    changedPaths = [...new Set(input.changedPaths || [])].sort();
  const complete = Object.keys(commands)
    .filter((name) => changedPaths.some((file) => matches(commands[name], file)))
    .sort();
  const declared = capabilities.policy?.candidate_push || {};
  const candidateNames = Array.isArray(declared.candidate_commands)
    ? new Set(declared.candidate_commands)
    : null;
  const targeted = complete.filter((name) =>
    candidateNames
      ? candidateNames.has(name)
      : commands[name].candidate !== false && commands[name].candidate !== "complete-only"
  );
  const skipped = complete.filter((name) => !targeted.includes(name));
  const declaredSkips = new Set(
    Array.isArray(declared.skipped_commands) ? declared.skipped_commands : []
  );
  const permitted =
    capabilities.policy?.provenance !== "candidate" &&
    capabilities.policy?.provenance === "authenticated" &&
    declared.permitted === true &&
    skipped.every((x) => declaredSkips.has(x)) &&
    declaredSkips.size === skipped.length;
  const refLines = input.refUpdates || [];
  validateGitPushInputs(input.remote, input.remoteUrl, refLines);
  const plan = {
    schema_version: 1,
    repository_root: input.root,
    changed_paths: changedPaths,
    capability_identity: capabilities.identity || null,
    expectations: {
      runtimes: capabilities.runtimes || [],
      probes: capabilities.policy?.probes || [],
    },
    targeted_commands: targeted,
    complete_commands: complete,
    command_identity: digest(commands),
    candidate_push: {
      permitted,
      declaration_provenance: capabilities.policy?.provenance || "absent",
      executed_commands: targeted,
      skipped_commands: skipped,
      declared_skipped_commands: [...declaredSkips].sort(),
    },
    adapter: {
      kind: input.adapterKind || "lefthook-v1",
      supported: input.adapterSupported !== false && capabilities.lefthook?.supported !== false,
      manager_version: input.managerVersion || null,
    },
    hook: capabilities.hooks?.pre_push?.path || input.hook || null,
    hook_identity: capabilities.hooks?.pre_push || input.hookIdentity || null,
    remote: {
      name: input.remote || null,
      url: input.remoteUrl || null,
      stdin: refLines.length ? `${refLines.join("\n")}\n` : "",
    },
    environment_identity: input.environmentIdentity || null,
  };
  plan.plan_digest = digest(planMaterial(plan));
  return plan;
}

function verifyPlanDigest(plan) {
  return plan?.plan_digest === digest(planMaterial(plan));
}

function git(root, args) {
  const result = childProcess.spawnSync("git", args, { cwd: root, encoding: "utf8", shell: false });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  return result.stdout.trim();
}

function main(argv = process.argv.slice(2)) {
  const value = (flag, fallback) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : fallback;
  };
  const root = fs.realpathSync(path.resolve(value("--root", process.cwd()))),
    base = value("--base"),
    head = value("--head", "HEAD");
  if (!base) throw new Error("--base SHA is required");
  const capabilities = discoverRepositoryCapabilities(root, {
    protectedCommit: base,
  });
  const changedPaths = git(root, ["diff", "--name-only", `${base}...${head}`])
    .split(/\r?\n/)
    .filter(Boolean);
  const plan = buildDeliveryPlan({
    root,
    changedPaths,
    commands: capabilities.lefthook?.commands || {},
    capabilities,
    managerVersion: capabilities.lefthook?.manager_version,
    remote: value("--remote"),
    remoteUrl: value("--remote-url"),
  });
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}
if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { buildDeliveryPlan, verifyPlanDigest, globToRegex, validateGitPushInputs };
