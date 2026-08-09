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
  return globs.some((glob) => globToRegex(glob).test(changedPath));
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
    ["protected", "protected-base", "approved", "authenticated"].includes(
      capabilities.policy?.provenance
    ) &&
    declared.permitted === true &&
    skipped.every((x) => declaredSkips.has(x)) &&
    declaredSkips.size === skipped.length;
  const refLines = input.refUpdates || [];
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
      supported: input.adapterSupported !== false,
      manager_version: input.managerVersion || null,
    },
    hook: capabilities.hooks?.pre_push?.path || input.hook || null,
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
    protectedRoot: value("--protected-root") || undefined,
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

module.exports = { buildDeliveryPlan, verifyPlanDigest, globToRegex };
