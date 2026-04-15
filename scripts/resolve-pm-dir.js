#!/usr/bin/env node
"use strict";

// Resolve the pm/ directory for a project.
//
// Resolution order:
//   1. {projectDir}/.pm/config.json with `pm_repo.path` → resolve relative to
//      that config's parent and return `{resolved}/pm`.
//   2. If projectDir is inside a git worktree whose main repo lives elsewhere,
//      try the main repo's .pm/config.json the same way.
//   3. Fallback: {projectDir}/pm (same-repo mode).
//
// Step 2 exists because `.pm/` is gitignored. A worktree created from a repo
// in separate-repo mode has no `.pm/` of its own, but the main repo does.
//
// CLI usage:
//   node scripts/resolve-pm-dir.js [projectDir]
// Prints the resolved pm directory to stdout.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

function defaultGitCommonDir(projectDir) {
  try {
    const result = execFileSync("git", ["rev-parse", "--git-common-dir"], {
      cwd: projectDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!result) return null;
    return path.isAbsolute(result) ? result : path.resolve(projectDir, result);
  } catch {
    return null;
  }
}

// Read .pm/config.json under configRoot and translate `pm_repo` into a pm dir.
// Returns the resolved pm dir, or null if there is nothing usable here (no
// config, malformed, missing field, or target dir does not exist on disk).
// Throws only for explicitly unsupported types (e.g. remote repos).
function tryConfigBased(configRoot) {
  const configPath = path.join(configRoot, ".pm", "config.json");

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

  return path.join(resolvedRoot, "pm");
}

function resolvePmDir(projectDir, options = {}) {
  // 1. Direct: projectDir's own .pm/config.json
  const direct = tryConfigBased(projectDir);
  if (direct !== null) return direct;

  // 2. Worktree walk: if projectDir is inside a worktree, the main repo may
  //    hold the config.
  const gitCommonDir = options.gitCommonDir || defaultGitCommonDir;
  const commonDir = gitCommonDir(projectDir);
  if (commonDir && path.basename(commonDir) === ".git") {
    const mainRepoRoot = path.dirname(commonDir);
    if (path.resolve(mainRepoRoot) !== path.resolve(projectDir)) {
      const fromMain = tryConfigBased(mainRepoRoot);
      if (fromMain !== null) return fromMain;
    }
  }

  // 3. Fallback: same-repo mode at projectDir
  return path.join(projectDir, "pm");
}

module.exports = {
  resolvePmDir,
  tryConfigBased,
  defaultGitCommonDir,
};

if (require.main === module) {
  const projectDir = process.argv[2]
    ? path.resolve(process.argv[2])
    : process.cwd();
  try {
    process.stdout.write(resolvePmDir(projectDir) + "\n");
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
}
