#!/usr/bin/env node
"use strict";

// Resolve the PM content, private state, and source repository paths from one
// closed contract. An absent config permits same-repo fallback. Once a config
// exists, parse errors, unsupported pointers, and missing targets are fatal so
// callers cannot silently write a new local pm/ tree.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const GIT_ENV_KEYS_TO_CLEAR = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_PREFIX",
  "GIT_NAMESPACE",
  "GIT_SUPER_PREFIX",
];
const FLAT_MARKERS = ["backlog", "evidence", "insights", "thinking", "memory.md", "strategy.md"];

function cleanGitEnv() {
  const env = { ...process.env };
  for (const key of GIT_ENV_KEYS_TO_CLEAR) delete env[key];
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

const warnedAboutBothConfigs = new Set();

function readConfig(configRoot) {
  const nestedPath = path.join(configRoot, ".pm", "config.json");
  const flatPath = path.join(configRoot, "pm.config.json");
  const nestedExists = fs.existsSync(nestedPath);
  const flatExists = fs.existsSync(flatPath);
  const warnings = [];

  let configPath = null;
  if (nestedExists && flatExists) {
    const warning =
      `both .pm/config.json and pm.config.json present at ${configRoot} — ` +
      "using .pm/config.json for back-compat. Remove .pm/config.json once migrated.";
    warnings.push(warning);
    if (!warnedAboutBothConfigs.has(configRoot)) {
      process.stderr.write(`pm-resolver: ${warning}\n`);
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
  } catch (error) {
    throw new Error(`Invalid JSON in ${configPath}: ${error.message}`);
  }
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error(`Invalid PM config in ${configPath}: expected a JSON object`);
  }
  if (Object.hasOwn(config, "pm_repo") && Object.hasOwn(config, "source_repo")) {
    throw new Error(
      `Invalid PM config in ${configPath}: pm_repo and source_repo cannot both be set`
    );
  }
  return { config, configPath, warnings };
}

function resolvePointer(configPath, field, label) {
  const pointer = field;
  if (!pointer || typeof pointer !== "object" || Array.isArray(pointer)) {
    throw new Error(`Invalid ${label} pointer in ${configPath}: expected an object`);
  }
  if (pointer.type && pointer.type !== "local") {
    throw new Error(
      `Remote repos not yet supported (${label}.type: "${pointer.type}") in ${configPath}`
    );
  }
  if (typeof pointer.path !== "string" || pointer.path.trim() === "") {
    throw new Error(`Invalid ${label} pointer in ${configPath}: path is required`);
  }
  return path.resolve(path.dirname(configPath), pointer.path);
}

function requireDirectory(target, configPath, description) {
  let isDirectory = false;
  try {
    isDirectory = fs.statSync(target).isDirectory();
  } catch {
    // Report one stable error for absent, inaccessible, and non-directory targets.
  }
  if (!isDirectory) {
    throw new Error(`${description} does not exist: ${target} (configured in ${configPath})`);
  }
}

function contentLayout(repoRoot) {
  const nested = path.join(repoRoot, "pm");
  if (fs.existsSync(nested)) return { layout: "nested", pmDir: nested };
  if (FLAT_MARKERS.some((name) => fs.existsSync(path.join(repoRoot, name)))) {
    return { layout: "flat", pmDir: repoRoot };
  }
  // A fresh separate PM repository uses the documented nested convention.
  return { layout: "nested", pmDir: nested };
}

function stateDirForRepo(repoRoot) {
  return path.join(repoRoot, ".pm");
}

function sameRepoResult(projectDir, configInfo = null) {
  return {
    ok: true,
    pmDir: path.join(projectDir, "pm"),
    pmStateDir: path.join(projectDir, ".pm"),
    sourceDir: projectDir,
    mode: "same-repo",
    configPath: configInfo ? configInfo.configPath : null,
    warnings: configInfo ? configInfo.warnings : [],
  };
}

function resultFromConfig(configRoot, projectDir, configInfo, modeOverride = null) {
  const { config, configPath, warnings } = configInfo;

  if (Object.hasOwn(config, "pm_repo")) {
    const pmRepoRoot = resolvePointer(configPath, config.pm_repo, "pm_repo");
    if (pmRepoRoot === path.resolve(configRoot)) {
      return sameRepoResult(projectDir, configInfo);
    }
    requireDirectory(pmRepoRoot, configPath, "Configured PM repository");
    const { layout, pmDir } = contentLayout(pmRepoRoot);
    return {
      ok: true,
      pmDir,
      pmStateDir: stateDirForRepo(pmRepoRoot),
      sourceDir: projectDir,
      mode: modeOverride || `separate-${layout}`,
      configPath,
      warnings,
    };
  }

  if (Object.hasOwn(config, "source_repo")) {
    const sourceDir = resolvePointer(configPath, config.source_repo, "source_repo");
    requireDirectory(sourceDir, configPath, "Configured source repository");
    const { layout, pmDir } = contentLayout(projectDir);
    return {
      ok: true,
      pmDir,
      pmStateDir: stateDirForRepo(projectDir),
      sourceDir,
      mode: modeOverride || `separate-${layout}`,
      configPath,
      warnings,
    };
  }

  return sameRepoResult(projectDir, configInfo);
}

// Compatibility helper retained for existing in-process callers and tests.
// It now throws for invalid configured state rather than collapsing it to null.
function tryConfigBased(configRoot) {
  const configInfo = readConfig(configRoot);
  if (!configInfo) return null;
  if (
    !Object.hasOwn(configInfo.config, "pm_repo") &&
    !Object.hasOwn(configInfo.config, "source_repo")
  ) {
    return null;
  }
  return resultFromConfig(configRoot, configRoot, configInfo).pmDir;
}

function resolvePmStateDir(pmDir) {
  const innerDotPm = path.join(pmDir, ".pm");
  const parentDotPm = path.join(path.dirname(pmDir), ".pm");
  if (fs.existsSync(innerDotPm)) return innerDotPm;
  if (fs.existsSync(parentDotPm)) return parentDotPm;
  return parentDotPm;
}

const pmPathsCache = new Map();

function resolvePmPaths(projectDir, options = {}) {
  const absoluteProjectDir = path.resolve(projectDir);
  const cacheable = !options.gitCommonDir;
  if (cacheable && pmPathsCache.has(absoluteProjectDir)) {
    return { ...pmPathsCache.get(absoluteProjectDir) };
  }

  const directConfig = readConfig(absoluteProjectDir);
  if (directConfig) {
    const result = resultFromConfig(absoluteProjectDir, absoluteProjectDir, directConfig);
    if (cacheable) pmPathsCache.set(absoluteProjectDir, result);
    return { ...result };
  }

  const gitCommonDir = options.gitCommonDir || defaultGitCommonDir;
  const commonDir = gitCommonDir(absoluteProjectDir);
  if (commonDir && path.basename(commonDir) === ".git") {
    const mainRepoRoot = path.dirname(commonDir);
    if (path.resolve(mainRepoRoot) !== absoluteProjectDir) {
      const mainConfig = readConfig(mainRepoRoot);
      if (mainConfig) {
        const result = resultFromConfig(
          mainRepoRoot,
          absoluteProjectDir,
          mainConfig,
          "worktree-main-config"
        );
        if (cacheable) pmPathsCache.set(absoluteProjectDir, result);
        return { ...result };
      }
    }
  }

  const fallback = sameRepoResult(absoluteProjectDir);
  if (cacheable) pmPathsCache.set(absoluteProjectDir, fallback);
  return { ...fallback };
}

function resolvePmDir(projectDir, options = {}) {
  return resolvePmPaths(projectDir, options).pmDir;
}

function _clearCache() {
  pmPathsCache.clear();
  warnedAboutBothConfigs.clear();
}

module.exports = {
  resolvePmDir,
  resolvePmPaths,
  resolvePmStateDir,
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
    const result = resolvePmPaths(projectDir);
    process.stdout.write((wantJson ? JSON.stringify(result) : result.pmDir) + "\n");
  } catch (error) {
    process.stderr.write(`Error: ${error.message}\n`);
    process.exitCode = 1;
  }
}
