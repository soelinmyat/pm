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

function resolveLefthook(root, env = process.env) {
  const candidates = [];
  if (env.LEFTHOOK_BIN) candidates.push(env.LEFTHOOK_BIN);
  const which = childProcess.spawnSync(
    process.platform === "win32" ? "where" : "which",
    ["lefthook"],
    { encoding: "utf8", env, shell: false, timeout: 1000 }
  );
  if (which.status === 0 && which.stdout.trim())
    candidates.push(which.stdout.trim().split(/\r?\n/)[0]);
  for (const relative of ["node_modules/.bin/lefthook", "node_modules/lefthook/bin/index.js"])
    candidates.push(path.join(root, relative));
  for (const candidate of candidates) {
    try {
      const real = fs.realpathSync(candidate),
        stat = fs.lstatSync(real);
      if (stat.isFile() && !stat.isSymbolicLink()) return real;
    } catch {
      /* try next bounded candidate */
    }
  }
  return null;
}

function loadLefthookDump(root, options) {
  if (options.lefthookDump)
    return {
      dump: options.lefthookDump,
      version: options.lefthookVersion || null,
      binary: options.lefthookBinary || null,
    };
  const binary = resolveLefthook(root, options.env);
  if (!binary) return { dump: null, version: null, binary: null };
  const dump = childProcess.spawnSync(binary, ["dump", "--format", "json"], {
    cwd: root,
    env: options.env || process.env,
    encoding: "utf8",
    shell: false,
    timeout: 3000,
    maxBuffer: MAX_FILE,
  });
  const version = childProcess.spawnSync(binary, ["version"], {
    cwd: root,
    env: options.env || process.env,
    encoding: "utf8",
    shell: false,
    timeout: 1000,
    maxBuffer: 8192,
  });
  if (dump.status !== 0)
    return { dump: null, version: String(version.stdout || "").trim() || null, binary };
  try {
    return {
      dump: JSON.parse(dump.stdout),
      version: String(version.stdout || "").trim() || null,
      binary,
    };
  } catch {
    return { dump: null, version: String(version.stdout || "").trim() || null, binary };
  }
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

function readPolicy(root, protectedRoot, identities) {
  const relative = ".pm/repository-delivery-policy.json";
  if (protectedRoot) {
    const text = safeRead(protectedRoot, relative);
    if (text !== null) {
      identities.push(fileIdentity(protectedRoot, relative));
      return parsePolicy(text, protectedRoot === root ? "protected" : "protected-base");
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
  if (!dump || typeof dump !== "object" || Array.isArray(dump)) return {};
  const commands = dump["pre-push"]?.commands;
  if (!commands || typeof commands !== "object" || Array.isArray(commands)) return {};
  const out = {};
  for (const [name, command] of Object.entries(commands)) {
    if (
      !/^[A-Za-z0-9._-]+$/.test(name) ||
      !command ||
      typeof command !== "object" ||
      typeof command.run !== "string"
    )
      continue;
    out[name] = {
      run: command.run,
      glob: command.glob || "**/*",
      exclude: command.exclude || null,
    };
  }
  return out;
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
  const protectedRoot = options.protectedRoot ? fs.realpathSync(options.protectedRoot) : null;
  const policy = readPolicy(root, protectedRoot, identities);
  const hookPath = path.join(root, ".git/hooks/pre-push");
  let hook = { exists: false, path: hookPath, sha256: null };
  if (fs.existsSync(hookPath)) {
    const stat = fs.lstatSync(hookPath);
    if (stat.isFile() && !stat.isSymbolicLink() && stat.size <= MAX_FILE) {
      const bytes = fs.readFileSync(hookPath);
      hook = {
        exists: true,
        path: fs.realpathSync(hookPath),
        sha256: `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`,
      };
    }
  }
  const lefthook = loadLefthookDump(root, options);
  const lefthookCommands = parseLefthookDump(lefthook.dump);
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
    hooks: { pre_push: hook },
    lefthook: {
      binary: lefthook.binary,
      manager_version: lefthook.version,
      commands: lefthookCommands,
      dump_digest: digest(lefthook.dump),
    },
    policy,
    identities: identities.filter(Boolean),
  };
  result.identity = digest(result);
  return result;
}

module.exports = { safeRead, discoverRepositoryCapabilities, parseLefthookDump, resolveLefthook };
