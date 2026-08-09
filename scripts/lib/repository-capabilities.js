"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const childProcess = require("node:child_process");
const { digest } = require("./repository-gate-plan-schema");

const MAX_FILE = 1024 * 1024;

function safeRead(root, relative) {
  const lexical = path.resolve(root, relative);
  const rootReal = fs.realpathSync(root);
  if (!fs.existsSync(lexical)) return null;
  const stat = fs.lstatSync(lexical);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE) return null;
  const real = fs.realpathSync(lexical);
  if (real !== rootReal && !real.startsWith(`${rootReal}${path.sep}`)) return null;
  return fs.readFileSync(real, "utf8");
}

function fileIdentity(root, relative) {
  const text = safeRead(root, relative);
  return text === null
    ? null
    : {
        path: relative,
        sha256: `sha256:${crypto.createHash("sha256").update(text).digest("hex")}`,
      };
}

function parsePackage(root, runtimes, commands, identities) {
  const text = safeRead(root, "package.json");
  if (text === null) return;
  identities.push(fileIdentity(root, "package.json"));
  try {
    const pkg = JSON.parse(text);
    if (pkg.engines?.node)
      runtimes.push({
        name: "node",
        constraint: String(pkg.engines.node),
        source: "package.json#engines.node",
        scope: "local",
      });
    if (pkg.packageManager)
      runtimes.push({
        name: String(pkg.packageManager).split("@")[0],
        constraint: String(pkg.packageManager).split("@").slice(1).join("@"),
        source: "package.json#packageManager",
        scope: "local",
      });
    Object.assign(commands, pkg.scripts || {});
  } catch {
    /* malformed files become identity inputs and unsupported capability */
  }
}

function parseToolVersions(root, runtimes, identities) {
  for (const name of [".nvmrc", ".node-version"]) {
    const text = safeRead(root, name);
    if (text !== null) {
      identities.push(fileIdentity(root, name));
      runtimes.push({
        name: "node",
        constraint: text.trim().replace(/^v/, ""),
        source: name,
        scope: "local",
      });
    }
  }
  const tool = safeRead(root, ".tool-versions");
  if (tool !== null) {
    identities.push(fileIdentity(root, ".tool-versions"));
    for (const line of tool.split(/\r?\n/)) {
      const [name, version] = line.trim().split(/\s+/, 2);
      if (name && version)
        runtimes.push({ name, constraint: version, source: ".tool-versions", scope: "local" });
    }
  }
}

function workflowFiles(root) {
  const dir = path.join(root, ".github/workflows");
  if (!fs.existsSync(dir) || !fs.lstatSync(dir).isDirectory()) return [];
  return fs
    .readdirSync(dir)
    .filter((x) => /\.ya?ml$/.test(x))
    .sort()
    .map((x) => `.github/workflows/${x}`);
}

function instructionFiles(root, limit = 128) {
  const found = [];
  const walk = (dir, depth) => {
    if (depth > 4 || found.length >= limit) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (found.length >= limit || [".git", "node_modules", ".pm", "pm"].includes(entry.name))
        continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(absolute, depth + 1);
      else if (["AGENTS.md", "CLAUDE.md", ".codex.md"].includes(entry.name))
        found.push(path.relative(root, absolute).split(path.sep).join("/"));
    }
  };
  walk(root, 0);
  return found.sort();
}

function loadLefthookDump(root, options) {
  const receipt = options.lefthookReceipt;
  if (
    receipt?.authenticated === true &&
    typeof receipt.identity === "string" &&
    receipt.identity === options.expectedManagerIdentity &&
    receipt.dump &&
    receipt.dump_digest === digest(receipt.dump) &&
    receipt.manager &&
    typeof receipt.manager.version === "string" &&
    receipt.manager.version
  ) {
    try {
      const candidate = path.resolve(receipt.manager.path);
      const rootReal = fs.realpathSync(root);
      const stat = fs.lstatSync(candidate);
      const realpath = fs.realpathSync(candidate);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.size > MAX_FILE ||
        realpath === rootReal ||
        realpath.startsWith(`${rootReal}${path.sep}`) ||
        realpath !== receipt.manager.realpath
      )
        throw new Error("untrusted manager path");
      const sha256 = `sha256:${crypto.createHash("sha256").update(fs.readFileSync(realpath)).digest("hex")}`;
      if (sha256 !== receipt.manager.sha256) throw new Error("manager hash mismatch");
      const version = childProcess.spawnSync(realpath, ["version"], {
        cwd: root,
        env: { PATH: process.env.PATH || "" },
        encoding: "utf8",
        shell: false,
        timeout: 2000,
        maxBuffer: 8192,
      });
      const liveDump = childProcess.spawnSync(realpath, ["dump", "--format", "json"], {
        cwd: root,
        env: { PATH: process.env.PATH || "" },
        encoding: "utf8",
        shell: false,
        timeout: 3000,
        maxBuffer: MAX_FILE,
      });
      if (
        version.status !== 0 ||
        version.stdout.trim() !== receipt.manager.version ||
        liveDump.status !== 0
      )
        throw new Error("live manager identity mismatch");
      const liveDumpValue = JSON.parse(liveDump.stdout);
      if (digest(liveDumpValue) !== receipt.dump_digest)
        throw new Error("live manager dump mismatch");
      return {
        dump: liveDumpValue,
        version: receipt.manager.version,
        binary: realpath,
        identity: receipt.identity,
        manager: { ...receipt.manager, path: candidate, realpath },
      };
    } catch {
      /* invalid receipts fail closed */
    }
  }
  return { dump: null, version: null, binary: null };
}

function parseWorkflows(root, runtimes, identities) {
  for (const relative of workflowFiles(root)) {
    const text = safeRead(root, relative);
    if (text === null) continue;
    identities.push(fileIdentity(root, relative));
    const matches = [...text.matchAll(/node-version\s*:\s*["']?([^\s"']+)/g)];
    for (const match of matches)
      runtimes.push({ name: "node", constraint: match[1], source: relative, scope: "ci" });
  }
}

function parsePolicy(text, provenance) {
  try {
    const parsed = JSON.parse(text);
    if (
      parsed.schema_version !== 1 ||
      !parsed.candidate_push ||
      typeof parsed.candidate_push !== "object" ||
      Array.isArray(parsed.candidate_push)
    )
      throw new Error("schema");
    if (
      Object.keys(parsed).some(
        (key) => !["schema_version", "candidate_push", "probes"].includes(key)
      )
    )
      throw new Error("unknown policy field");
    if (
      Object.keys(parsed.candidate_push).some(
        (key) => !["permitted", "candidate_commands", "skipped_commands"].includes(key)
      )
    )
      throw new Error("unknown candidate policy field");
    if (typeof parsed.candidate_push.permitted !== "boolean")
      throw new Error("candidate permission must be boolean");
    for (const key of ["candidate_commands", "skipped_commands"]) {
      const values = parsed.candidate_push[key] || [];
      if (
        !Array.isArray(values) ||
        values.some((value) => typeof value !== "string" || !/^[A-Za-z0-9._-]+$/.test(value)) ||
        new Set(values).size !== values.length
      )
        throw new Error(`invalid ${key}`);
    }
    if (parsed.probes !== undefined && !Array.isArray(parsed.probes))
      throw new Error("probes must be an array");
    return {
      ...parsed,
      probes: (parsed.probes || []).map((probe) => ({ ...probe, provenance })),
      provenance,
    };
  } catch {
    return { candidate_push: { permitted: false }, probes: [], provenance: "malformed" };
  }
}

function runGit(root, args) {
  return childProcess.spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    shell: false,
    timeout: 2000,
    maxBuffer: MAX_FILE,
  });
}

function verifyProtectedCommitAuthority(root, options) {
  const commit = options.protectedCommit;
  const receipt = options.defaultBranchReceipt;
  if (
    !/^[0-9a-f]{40,64}$/i.test(commit || "") ||
    commit !== options.expectedProtectedCommit ||
    receipt?.authenticated !== true ||
    typeof receipt.identity !== "string" ||
    receipt.identity !== options.expectedRemoteIdentity ||
    receipt.ref !== options.expectedDefaultRef ||
    !/^[A-Za-z0-9._-]+$/.test(receipt.remote || "") ||
    !String(receipt.ref || "").startsWith(`refs/remotes/${receipt.remote}/`) ||
    !/^[0-9a-f]{40,64}$/i.test(receipt.commit || "") ||
    typeof receipt.remote_url !== "string" ||
    !receipt.remote_url
  )
    return null;
  const remoteUrl = runGit(root, ["remote", "get-url", "--push", receipt.remote]);
  const remoteHead = runGit(root, ["rev-parse", "--verify", `${receipt.ref}^{commit}`]);
  const ancestor = runGit(root, ["merge-base", "--is-ancestor", commit, receipt.commit]);
  if (
    remoteUrl.status !== 0 ||
    remoteUrl.stdout.trim() !== receipt.remote_url ||
    remoteHead.status !== 0 ||
    remoteHead.stdout.trim() !== receipt.commit ||
    ancestor.status !== 0
  )
    return null;
  return receipt;
}

function readPolicy(root, options, identities) {
  const relative = ".pm/repository-delivery-policy.json";
  if (typeof options.policyVerifier === "function") {
    const verified = options.policyVerifier({ root, relative });
    if (
      verified?.verified === true &&
      typeof verified.bytes === "string" &&
      typeof verified.source === "string" &&
      verified.source &&
      verified.identity
    ) {
      identities.push({
        path: verified.source,
        sha256: digest(verified.bytes),
        authority_identity: String(verified.identity),
      });
      return { ...parsePolicy(verified.bytes, "authenticated"), authority: verified.source };
    }
  }
  const remoteAuthority = verifyProtectedCommitAuthority(root, options);
  if (remoteAuthority) {
    const commit = options.protectedCommit;
    const verified = runGit(root, ["cat-file", "-e", `${commit}^{commit}`]);
    const shown = runGit(root, ["show", `${commit}:${relative}`]);
    if (
      verified.status === 0 &&
      shown.status === 0 &&
      Buffer.byteLength(shown.stdout) <= MAX_FILE
    ) {
      identities.push({
        path: `remote:${remoteAuthority.remote}:${remoteAuthority.ref}`,
        sha256: digest({
          identity: remoteAuthority.identity,
          remote_url: remoteAuthority.remote_url,
          commit: remoteAuthority.commit,
        }),
      });
      identities.push({
        path: `git:${commit}:${relative}`,
        sha256: digest(shown.stdout),
        authority_identity: remoteAuthority.identity,
      });
      return {
        ...parsePolicy(shown.stdout, "authenticated"),
        authority: `git:${commit}:${relative}`,
      };
    }
  }
  const candidate = safeRead(root, relative);
  if (candidate !== null) {
    identities.push(fileIdentity(root, relative));
    return parsePolicy(candidate, "candidate");
  }
  return { candidate_push: { permitted: false }, probes: [], provenance: "absent" };
}

function parseLefthookDump(dump) {
  const unsupported = (issue) => ({ commands: {}, supported: false, issues: [issue] });
  if (!dump || typeof dump !== "object" || Array.isArray(dump))
    return unsupported("missing authenticated dump");
  const commands = dump["pre-push"]?.commands;
  if (!commands || typeof commands !== "object" || Array.isArray(commands))
    return unsupported("missing pre-push commands");
  const out = {};
  const issues = [];
  const validPattern = (value) => {
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      value.length > 1024 ||
      !/^[A-Za-z0-9._/*?{},-]+$/.test(value) ||
      ["!", "[", "]", "(", ")", "|", "\\"].some((token) => value.includes(token))
    )
      return false;
    let depth = 0;
    for (const char of value) {
      if (char === "{") depth++;
      if (char === "}" && --depth < 0) return false;
      if (depth > 1) return false;
    }
    return depth === 0;
  };
  for (const [name, command] of Object.entries(commands)) {
    if (
      !/^[A-Za-z0-9._-]+$/.test(name) ||
      !command ||
      typeof command !== "object" ||
      Array.isArray(command) ||
      typeof command.run !== "string" ||
      !command.run.trim() ||
      (command.glob !== undefined &&
        !validPattern(command.glob) &&
        (!Array.isArray(command.glob) || command.glob.some((value) => !validPattern(value)))) ||
      (command.exclude !== undefined &&
        command.exclude !== null &&
        !validPattern(command.exclude) &&
        (!Array.isArray(command.exclude) ||
          command.exclude.some((value) => !validPattern(value)))) ||
      Object.keys(command).some((key) => !["run", "glob", "exclude"].includes(key))
    ) {
      issues.push(`unsupported pre-push command ${name}`);
      continue;
    }
    out[name] = {
      run: command.run,
      glob: command.glob || "**/*",
      exclude: command.exclude || null,
    };
  }
  return issues.length
    ? { commands: {}, supported: false, issues }
    : { commands: out, supported: true, issues: [] };
}

function resolvePrePushHook(root) {
  const gitPath = childProcess.spawnSync("git", ["rev-parse", "--git-path", "hooks/pre-push"], {
    cwd: root,
    encoding: "utf8",
    shell: false,
    timeout: 2000,
  });
  const candidate =
    gitPath.status === 0 && gitPath.stdout.trim()
      ? path.resolve(root, gitPath.stdout.trim())
      : path.join(root, ".git/hooks/pre-push");
  let hook = { exists: false, path: candidate, realpath: null, sha256: null };
  try {
    const stat = fs.lstatSync(candidate);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE) return hook;
    const realpath = fs.realpathSync(candidate);
    const bytes = fs.readFileSync(realpath);
    hook = {
      exists: true,
      path: candidate,
      realpath,
      sha256: `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`,
    };
  } catch {
    /* absent or unsafe hook */
  }
  return hook;
}

function discoverRepositoryCapabilities(rootInput, options = {}) {
  const root = fs.realpathSync(path.resolve(rootInput));
  const runtimes = [],
    identities = [],
    commands = {};
  for (const relative of [
    ...instructionFiles(root),
    "lefthook.yml",
    "lefthook-local.yml",
    "pnpm-lock.yaml",
    "package-lock.json",
    "yarn.lock",
  ]) {
    const identity = fileIdentity(root, relative);
    if (identity) identities.push(identity);
  }
  parseToolVersions(root, runtimes, identities);
  parsePackage(root, runtimes, commands, identities);
  parseWorkflows(root, runtimes, identities);
  const policy = readPolicy(root, options, identities);
  const hook = resolvePrePushHook(root);
  const lefthook = loadLefthookDump(root, options);
  const lefthookContract = parseLefthookDump(lefthook.dump);
  const githubReceipt = options.githubReceipt;
  const githubFacts = githubReceipt?.facts;
  const githubCapabilities =
    githubReceipt?.authenticated === true &&
    githubReceipt.identity === options.expectedGithubIdentity &&
    githubFacts &&
    ["branch_protection", "required_checks", "merge_queue"].every(
      (key) => typeof githubFacts[key] === "boolean"
    ) &&
    Object.keys(githubFacts).every((key) =>
      ["branch_protection", "required_checks", "merge_queue"].includes(key)
    )
      ? { available: true, identity: githubReceipt.identity, facts: githubFacts }
      : { available: false, identity: null, facts: null };
  const result = {
    schema_version: 1,
    root,
    runtimes,
    commands,
    instructions: identities.filter((x) => /AGENTS|CLAUDE|codex/.test(x.path)),
    workflows: identities.filter((x) => x.path.startsWith(".github/workflows/")),
    github_hints: {
      merge_group: identities
        .filter((x) => x.path.startsWith(".github/workflows/"))
        .some((identity) => /merge_group/.test(safeRead(root, identity.path) || "")),
    },
    github_capabilities: githubCapabilities,
    hooks: { pre_push: hook },
    lefthook: {
      binary: lefthook.binary,
      manager_version: lefthook.version,
      commands: lefthookContract.commands,
      supported: lefthookContract.supported,
      issues: lefthookContract.issues,
      dump_digest: digest(lefthook.dump),
      identity: lefthook.identity || null,
      manager: lefthook.manager || null,
    },
    policy,
    identities: identities.filter(Boolean),
  };
  result.identity = digest(result);
  return result;
}

module.exports = {
  safeRead,
  discoverRepositoryCapabilities,
  parseLefthookDump,
  resolvePrePushHook,
};
