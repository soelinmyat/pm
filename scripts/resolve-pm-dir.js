#!/usr/bin/env node
"use strict";

// Resolve the pm/ directory for a project.
//
// Resolution order:
//   1. {projectDir}/.pm/config.json (nested) or {projectDir}/pm.config.json
//      (flat) with `pm_repo.path` → resolve relative to that config's parent
//      and return `{resolved}/pm`.
//   2. If projectDir is inside a git worktree whose main repo lives elsewhere,
//      try the main repo's config the same way.
//   3. Fallback: {projectDir}/pm (same-repo mode).
//
// Step 2 exists because `.pm/` is gitignored. A worktree created from a repo
// in separate-repo mode has no `.pm/` of its own, but the main repo does.
//
// The flat `pm.config.json` form exists so projects can stop carrying a
// `.pm/` directory entirely — eliminating the worktree-fragmentation footgun
// where writers like pm-log.js create per-worktree `.pm/` trees. A tracked
// `pm.config.json` at the repo root is the only thing pm needs to find the
// storage repo.
//
// CLI usage:
//   node scripts/resolve-pm-dir.js [projectDir]
// Prints the resolved pm directory to stdout.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

// Git hooks and worktree-aware invocations export repo-scoped env vars that
// hijack child git commands — making them report on the parent repo even when
// cwd is unrelated. Strip them so the child git discovers the repo from cwd.
const GIT_ENV_KEYS_TO_CLEAR = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_PREFIX",
  "GIT_NAMESPACE",
  "GIT_SUPER_PREFIX",
];

function cleanGitEnv() {
  const env = { ...process.env };
  for (const key of GIT_ENV_KEYS_TO_CLEAR) {
    delete env[key];
  }
  return env;
}

function defaultGitCommonDir(projectDir) {
  try {
    const result = execFileSync("git", ["rev-parse", "--git-common-dir"], {
      cwd: projectDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      env: cleanGitEnv(),
    }).trim();
    if (!result) return null;
    return path.isAbsolute(result) ? result : path.resolve(projectDir, result);
  } catch {
    return null;
  }
}

// Track which configRoots already had a both-configs warning emitted so we
// only warn once per process per root.
const warnedAboutBothConfigs = new Set();

// Read .pm/config.json (nested) or pm.config.json (flat) under configRoot and
// translate `pm_repo` into a pm dir. Returns the resolved pm dir, or null if
// there is nothing usable here (no config, malformed, missing field, or
// target dir does not exist on disk). Throws only for explicitly unsupported
// types (e.g. remote repos).
function tryConfigBased(configRoot) {
  const nestedPath = path.join(configRoot, ".pm", "config.json");
  const flatPath = path.join(configRoot, "pm.config.json");

  const nestedExists = fs.existsSync(nestedPath);
  const flatExists = fs.existsSync(flatPath);

  let configPath;
  if (nestedExists && flatExists) {
    if (!warnedAboutBothConfigs.has(configRoot)) {
      process.stderr.write(
        `pm-resolver: both .pm/config.json and pm.config.json present at ${configRoot} — using .pm/config.json for back-compat. Remove .pm/config.json once migrated.\n`
      );
      warnedAboutBothConfigs.add(configRoot);
    }
    configPath = nestedPath;
  } else if (nestedExists) {
    configPath = nestedPath;
  } else if (flatExists) {
    configPath = flatPath;
  } else {
    return null;
  }

  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return null;
  }

  if (!config || typeof config !== "object" || !config.pm_repo) {
    return null;
  }

  const pmRepo = config.pm_repo;

  if (pmRepo.type && pmRepo.type !== "local") {
    throw new Error(`Remote repos not yet supported (pm_repo.type: "${pmRepo.type}")`);
  }

  if (!pmRepo.path) {
    return null;
  }

  const configDir = path.dirname(configPath);
  const resolvedRoot = path.resolve(configDir, pmRepo.path);

  // Self-referential config: pm_repo points back to the config's own root.
  // Treat as same-repo for that root.
  if (resolvedRoot === path.resolve(configRoot)) {
    return path.join(configRoot, "pm");
  }

  try {
    fs.accessSync(resolvedRoot, fs.constants.F_OK);
  } catch {
    return null;
  }

  // Prefer the nested `{root}/pm/` convention when that subdir exists.
  // Otherwise, if the root itself has KB content markers (flat layout),
  // treat the root as the content dir. Fall back to the nested path so
  // fresh/empty separate-repo setups still match the documented convention.
  const nested = path.join(resolvedRoot, "pm");
  if (fs.existsSync(nested)) return nested;

  const flatMarkers = ["backlog", "evidence", "insights", "thinking", "memory.md", "strategy.md"];
  const isFlatLayout = flatMarkers.some((name) => fs.existsSync(path.join(resolvedRoot, name)));
  if (isFlatLayout) return resolvedRoot;

  return nested;
}

// Resolve both the content dir and the .pm state dir, accounting for flat vs
// nested layouts. In the nested convention, `.pm/` lives alongside `pm/` at
// the PM repo root; in the flat layout, `.pm/` lives inside the content dir.
function resolvePmPaths(projectDir, options = {}) {
  const pmDir = resolvePmDir(projectDir, options);
  const innerDotPm = path.join(pmDir, ".pm");
  const parentDotPm = path.join(path.dirname(pmDir), ".pm");

  let pmStateDir;
  if (fs.existsSync(innerDotPm)) {
    pmStateDir = innerDotPm;
  } else if (fs.existsSync(parentDotPm)) {
    pmStateDir = parentDotPm;
  } else {
    // Neither exists yet (fresh setup) — default to the nested convention.
    pmStateDir = parentDotPm;
  }

  return { pmDir, pmStateDir };
}

// In-process memoization. Helps callers like start-status / kb-sync-git that
// resolve repeatedly within a single node process. Skipped when the caller
// injects a custom gitCommonDir (tests) to keep behavior deterministic.
const pmDirCache = new Map();

function resolvePmDir(projectDir, options = {}) {
  const cacheable = !options.gitCommonDir;
  const cacheKey = cacheable ? path.resolve(projectDir) : null;
  if (cacheable && pmDirCache.has(cacheKey)) {
    return pmDirCache.get(cacheKey);
  }

  // 1. Direct: projectDir's own config (.pm/config.json or pm.config.json)
  const direct = tryConfigBased(projectDir);
  if (direct !== null) {
    if (cacheable) pmDirCache.set(cacheKey, direct);
    return direct;
  }

  // 2. Worktree walk: if projectDir is inside a worktree, the main repo may
  //    hold the config.
  const gitCommonDir = options.gitCommonDir || defaultGitCommonDir;
  const commonDir = gitCommonDir(projectDir);
  if (commonDir && path.basename(commonDir) === ".git") {
    const mainRepoRoot = path.dirname(commonDir);
    if (path.resolve(mainRepoRoot) !== path.resolve(projectDir)) {
      const fromMain = tryConfigBased(mainRepoRoot);
      if (fromMain !== null) {
        if (cacheable) pmDirCache.set(cacheKey, fromMain);
        return fromMain;
      }
    }
  }

  // 3. Fallback: same-repo mode at projectDir
  const fallback = path.join(projectDir, "pm");
  if (cacheable) pmDirCache.set(cacheKey, fallback);
  return fallback;
}

function _clearCache() {
  pmDirCache.clear();
  warnedAboutBothConfigs.clear();
}

module.exports = {
  resolvePmDir,
  resolvePmPaths,
  tryConfigBased,
  defaultGitCommonDir,
  _clearCache,
};

if (require.main === module) {
  const args = process.argv.slice(2);
  const jsonFlagIdx = args.indexOf("--json");
  const wantJson = jsonFlagIdx !== -1;
  if (wantJson) args.splice(jsonFlagIdx, 1);

  const projectDir = args[0] ? path.resolve(args[0]) : process.cwd();
  try {
    if (wantJson) {
      process.stdout.write(JSON.stringify(resolvePmPaths(projectDir)) + "\n");
    } else {
      process.stdout.write(resolvePmDir(projectDir) + "\n");
    }
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
}
