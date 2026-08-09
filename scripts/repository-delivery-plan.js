#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const { discoverRepositoryCapabilities } = require("./lib/repository-capabilities");
const { digest, planMaterial } = require("./lib/repository-gate-plan-schema");
const { redactText } = require("./repository-environment-preflight");
const { readProjectInput } = require("./lib/safe-project-output");

const MAX_INPUT = 1024 * 1024;

function readAuthenticatedJson(root, inputPath, expectedSha256) {
  if (!inputPath || !/^sha256:[0-9a-f]{64}$/i.test(expectedSha256 || ""))
    throw new Error("authenticated JSON path and sha256 are required");
  const absolute = path.resolve(root, inputPath);
  const relative = path.relative(path.resolve(root), absolute);
  const bytes = readProjectInput(root, relative, MAX_INPUT).bytes;
  const actual = `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
  if (actual !== expectedSha256) throw new Error("authenticated JSON sha256 mismatch");
  return JSON.parse(bytes.toString("utf8"));
}

function discoveryOptions(receipt, authority = {}) {
  if (!receipt || receipt.schema_version !== 1 || typeof receipt !== "object")
    throw new Error("discovery receipt schema is invalid");
  return {
    discoveryReceipt: receipt,
    expectedDiscoveryIdentity: authority.expectedDiscoveryIdentity || receipt.identity,
    receiptKey: authority.receiptKey,
    receiptVerifier: authority.receiptVerifier,
    now: authority.now,
    maxReceiptAgeMs: authority.maxReceiptAgeMs,
    expectedProtectedCommit: authority.expectedProtectedCommit,
    expectedDefaultRef: authority.expectedDefaultRef || receipt.expected_default_ref,
  };
}

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

function compileCommand(command, compileGlob = globToRegex) {
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
  return {
    includes: globs.map(compileGlob),
    excludes: excludes.map(compileGlob),
  };
}

function matches(compiled, changedPath) {
  return (
    compiled.includes.some((pattern) => pattern.test(changedPath)) &&
    !compiled.excludes.some((pattern) => pattern.test(changedPath))
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
  const compiledCommands = Object.fromEntries(
    Object.entries(commands).map(([name, command]) => [
      name,
      compileCommand(command, input.compileGlob),
    ])
  );
  const complete = Object.keys(commands)
    .filter((name) => changedPaths.some((file) => matches(compiledCommands[name], file)))
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
  const commandIdentity = digest(commands);
  const declaredCommandNames = [...(candidateNames ? candidateNames : []), ...declaredSkips];
  const permitted =
    capabilities.policy?.provenance !== "candidate" &&
    capabilities.policy?.provenance === "authenticated" &&
    declared.permitted === true &&
    candidateNames !== null &&
    declared.command_identity === commandIdentity &&
    declaredCommandNames.every((name) => Object.hasOwn(commands, name)) &&
    skipped.every((x) => declaredSkips.has(x)) &&
    declaredSkips.size === skipped.length;
  const refLines = input.refUpdates || [];
  validateGitPushInputs(input.remote, input.remoteUrl, refLines);
  const plan = {
    schema_version: 1,
    repository_root: input.root,
    base_commit: input.baseCommit || null,
    head_commit: input.headCommit || null,
    merge_base_commit: input.mergeBaseCommit || null,
    source_ref: input.sourceRef || null,
    expected_default_ref: input.expectedDefaultRef || null,
    changed_paths: changedPaths,
    capability_identity: capabilities.identity || null,
    expectations: {
      runtimes: capabilities.runtimes || [],
      probes: capabilities.policy?.probes || [],
    },
    targeted_commands: targeted,
    complete_commands: complete,
    command_identity: commandIdentity,
    candidate_push: {
      permitted,
      declaration_provenance: capabilities.policy?.provenance || "absent",
      executed_commands: targeted,
      skipped_commands: skipped,
      declared_skipped_commands: [...declaredSkips].sort(),
    },
    repository_policy: {
      provenance: capabilities.policy?.provenance || "absent",
      source: capabilities.policy?.source || null,
      delivery_bypass: capabilities.policy?.delivery_bypass || null,
    },
    adapter: {
      kind: input.adapterKind || "lefthook-v1",
      supported:
        input.adapterSupported !== false &&
        capabilities.lefthook?.supported === true &&
        capabilities.github_capabilities?.available === true,
      manager_version: input.managerVersion || null,
      manager_identity: capabilities.lefthook?.identity || null,
      manager: capabilities.lefthook?.manager || null,
      dump_digest: capabilities.lefthook?.dump_digest || null,
      hook_contract: capabilities.lefthook?.hook_contract || null,
      manager_environment: capabilities.lefthook?.manager_environment || null,
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

function parseGitPathOutput(output) {
  const fields = Buffer.from(output).toString("utf8").split("\0");
  if (fields.at(-1) !== "") throw new Error("Git path output is not NUL terminated");
  fields.pop();
  if (fields.some((value) => !value || value.includes("\0")))
    throw new Error("Git path output is malformed");
  return fields;
}

function gitPathOutput(root, args) {
  const result = childProcess.spawnSync("git", args, { cwd: root, encoding: null, shell: false });
  if (result.status !== 0) throw new Error(String(result.stderr || `git ${args.join(" ")} failed`));
  return parseGitPathOutput(result.stdout);
}

function main(argv = process.argv.slice(2)) {
  const value = (flag, fallback) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : fallback;
  };
  const root = fs.realpathSync(path.resolve(value("--root", process.cwd()))),
    base = value("--base"),
    head = value("--head", "HEAD");
  const remote = value("--remote"),
    remoteUrl = value("--remote-url"),
    refUpdatesPath = value("--ref-updates"),
    environmentPath = value("--environment-identity"),
    discoveryPath = value("--discovery-receipt");
  if (!base || !remote || !remoteUrl || !refUpdatesPath || !environmentPath || !discoveryPath)
    throw new Error(
      "--base, --remote, --remote-url, --ref-updates, --environment-identity, and --discovery-receipt are required"
    );
  const refUpdates = readAuthenticatedJson(root, refUpdatesPath, value("--ref-updates-sha256"));
  const environmentReceipt = readAuthenticatedJson(
    root,
    environmentPath,
    value("--environment-identity-sha256")
  );
  if (
    environmentReceipt?.schema_version !== 1 ||
    environmentReceipt.status !== "verified" ||
    !environmentReceipt.identity ||
    typeof environmentReceipt.identity !== "object" ||
    Array.isArray(environmentReceipt.identity)
  )
    throw new Error("environment identity requires a verified schema-v1 preflight receipt");
  const environmentIdentity = environmentReceipt.identity;
  const discoveryReceipt = readAuthenticatedJson(
    root,
    discoveryPath,
    value("--discovery-receipt-sha256")
  );
  if (discoveryReceipt.protected_commit !== base)
    throw new Error("base does not match authenticated protected commit");
  if (
    discoveryReceipt.default_branch?.remote !== remote ||
    discoveryReceipt.default_branch?.remote_url !== remoteUrl
  )
    throw new Error("destination remote does not match authenticated discovery receipt");
  const resolvedHead = git(root, ["rev-parse", "--verify", `${head}^{commit}`]);
  const mergeBase = git(root, ["merge-base", base, resolvedHead]);
  const sourceRef = git(root, ["symbolic-ref", "--quiet", "HEAD"]);
  if (discoveryReceipt.repository_head !== resolvedHead)
    throw new Error("head does not match authenticated discovery receipt");
  const receiptKey = process.env.PM_REPOSITORY_RECEIPT_KEY;
  if (!receiptKey) throw new Error("PM_REPOSITORY_RECEIPT_KEY is required for optimized planning");
  const capabilities = discoverRepositoryCapabilities(
    root,
    discoveryOptions(discoveryReceipt, {
      receiptKey,
      expectedProtectedCommit: base,
      expectedDefaultRef: discoveryReceipt.expected_default_ref,
    })
  );
  const changedPaths = gitPathOutput(root, [
    "diff",
    "--name-only",
    "-z",
    "--ignore-submodules=none",
    `${base}...${head}`,
  ]);
  const plan = buildDeliveryPlan({
    root,
    baseCommit: base,
    headCommit: resolvedHead,
    mergeBaseCommit: mergeBase,
    sourceRef,
    expectedDefaultRef: discoveryReceipt.expected_default_ref,
    changedPaths,
    commands: capabilities.lefthook?.commands || {},
    capabilities,
    managerVersion: capabilities.lefthook?.manager_version,
    remote,
    remoteUrl,
    refUpdates,
    environmentIdentity,
  });
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}
if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${redactText(error.message)}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  buildDeliveryPlan,
  verifyPlanDigest,
  globToRegex,
  validateGitPushInputs,
  readAuthenticatedJson,
  discoveryOptions,
  parseGitPathOutput,
};
