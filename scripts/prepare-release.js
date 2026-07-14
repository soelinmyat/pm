#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { writeJsonAtomic } = require("./lib/atomic-file");
const { createReleaseTransaction, transactionIssues } = require("./lib/release-transaction-schema");

const VERSION_FILES = [
  "plugin.config.json",
  ".claude-plugin/plugin.json",
  ".claude-plugin/marketplace.json",
  ".codex-plugin/plugin.json",
];

function parseArgs(argv) {
  const bump = argv[0];
  if (!bump || bump.startsWith("--")) throw new Error("version bump is required");
  const result = { bump, root: process.cwd(), session: null, transaction: null };
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!["--root", "--session", "--transaction"].includes(flag)) {
      throw new Error(`unknown argument ${flag}`);
    }
    const value = argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    result[flag.slice(2)] = value;
  }
  if (!result.session) throw new Error("--session is required");
  return result;
}

function prepareRelease(input, options = {}) {
  const root = fs.realpathSync(path.resolve(input.root || process.cwd()));
  const sessionPath = privatePath(root, input.session, "session");
  const session = readJson(sessionPath, "Dev session");
  if (session.authority?.commit !== true)
    throw new Error("Dev session does not grant commit authority");
  const branch = git(root, ["branch", "--show-current"]);
  if (!branch || branch === session.source?.default_branch) {
    throw new Error("prepare-release requires a feature branch");
  }
  if (branch !== session.source?.branch)
    throw new Error("Dev session branch does not match current branch");
  const transactionPath = privatePath(
    root,
    input.transaction ||
      path.join(path.dirname(path.relative(root, sessionPath)), "ship/release-transaction.json"),
    "transaction"
  );
  if (fs.existsSync(transactionPath)) {
    const existing = readJson(transactionPath, "release transaction");
    const issues = transactionIssues(existing);
    if (issues.length > 0)
      throw new Error(`invalid existing release transaction: ${issues.join("; ")}`);
    if (existing.run_id !== session.run_id) throw new Error("existing transaction run_id mismatch");
    const head = git(root, ["rev-parse", "HEAD"]);
    const version = readJson(path.join(root, "plugin.config.json"), "plugin config").version;
    if (existing.release.prepared_commit !== head || existing.release.next_version !== version) {
      throw new Error("existing prepared release does not match current HEAD and version");
    }
    removeIntent(transactionPath);
    return {
      status: "already-prepared",
      transaction_path: relative(root, transactionPath),
      transaction: existing,
    };
  }

  const intentPath = intentFile(transactionPath);
  let intent = fs.existsSync(intentPath) ? readJson(intentPath, "prepare intent") : null;
  const configPath = path.join(root, "plugin.config.json");
  const config = readJson(configPath, "plugin config");
  const headBefore = git(root, ["rev-parse", "HEAD"]);
  if (intent) {
    validateIntent(intent, session, branch);
    if (config.version === intent.next_version && isClean(root)) {
      const transaction = finalizeTransaction(root, session, intent, transactionPath);
      removeIntent(transactionPath);
      return {
        status: "reconciled",
        transaction_path: relative(root, transactionPath),
        transaction,
      };
    }
    if (
      headBefore !== intent.base_commit ||
      config.version !== intent.current_version ||
      !isClean(root)
    ) {
      throw new Error("incomplete prepare-release cannot be reconciled safely");
    }
  } else {
    if (!isClean(root)) throw new Error("prepare-release requires a clean tracked worktree");
    const nextVersion = nextVersionFor(config.version, input.bump);
    const tag = `v${nextVersion}`;
    if (git(root, ["tag", "-l", tag])) throw new Error(`release tag already exists: ${tag}`);
    intent = {
      schema_version: 1,
      run_id: session.run_id,
      branch,
      base_commit: headBefore,
      current_version: config.version,
      next_version: nextVersion,
      tag,
      created_at: (options.now || (() => new Date().toISOString()))(),
    };
    writeJsonAtomic(intentPath, intent, { directoryMode: 0o700, fileMode: 0o600 });
  }

  const snapshots = new Map(
    VERSION_FILES.map((file) => [file, fs.readFileSync(path.join(root, file))])
  );
  let committed = false;
  try {
    writeJsonAtomic(configPath, { ...config, version: intent.next_version });
    run(root, process.execPath, [
      path.join(__dirname, "generate-platform-files.js"),
      "--root",
      root,
    ]);
    verifyVersions(root, intent.next_version);
    run(root, "git", ["add", "--", ...VERSION_FILES]);
    run(root, "git", ["commit", "-m", `Prepare release v${intent.next_version}`]);
    committed = true;
    if (git(root, ["tag", "--points-at", "HEAD"]).split(/\r?\n/).includes(intent.tag)) {
      throw new Error("prepare-release must not create a feature-commit tag");
    }
    const transaction = finalizeTransaction(root, session, intent, transactionPath);
    removeIntent(transactionPath);
    return { status: "prepared", transaction_path: relative(root, transactionPath), transaction };
  } catch (error) {
    if (!committed) {
      for (const [file, bytes] of snapshots) fs.writeFileSync(path.join(root, file), bytes);
      run(root, "git", ["reset", "--quiet"]);
    }
    throw error;
  }
}

function finalizeTransaction(root, session, intent, transactionPath) {
  const preparedCommit = git(root, ["rev-parse", "HEAD"]);
  const version = readJson(path.join(root, "plugin.config.json"), "plugin config").version;
  if (version !== intent.next_version) throw new Error("prepared version does not match intent");
  if (!isClean(root))
    throw new Error("prepared release commit did not leave a clean tracked worktree");
  const urls = git(root, [
    "remote",
    "get-url",
    "--push",
    "--all",
    "--",
    session.source.delivery_remote,
  ])
    .split(/\r?\n/)
    .filter(Boolean);
  if (urls.length !== 1) throw new Error("delivery remote must have exactly one push URL");
  const repository = githubRepository(urls[0]);
  const manifests = VERSION_FILES.map((file) => ({
    path: file,
    sha256: digest(path.join(root, file)),
  }));
  const transaction = createReleaseTransaction({
    runId: session.run_id,
    slug: session.slug,
    repository,
    deliveryRemote: session.source.delivery_remote,
    headBranch: session.source.branch,
    baseBranch: session.source.default_branch,
    pushUrlSha256: digestText(urls[0]),
    currentVersion: intent.current_version,
    nextVersion: intent.next_version,
    preparedCommit,
    manifestHashes: manifests,
    timestamp: new Date().toISOString(),
  });
  writeJsonAtomic(transactionPath, transaction, { directoryMode: 0o700, fileMode: 0o600 });
  return transaction;
}

function nextVersionFor(current, requested) {
  if (!/^\d+\.\d+\.\d+$/.test(current || ""))
    throw new Error(`invalid current version: ${current}`);
  const [major, minor, patch] = current.split(".").map(Number);
  let next;
  if (requested === "patch") next = `${major}.${minor}.${patch + 1}`;
  else if (requested === "minor") next = `${major}.${minor + 1}.0`;
  else if (requested === "major") next = `${major + 1}.0.0`;
  else if (/^\d+\.\d+\.\d+$/.test(requested)) next = requested;
  else throw new Error(`invalid version request: ${requested}`);
  const before = current.split(".").map(Number);
  const after = next.split(".").map(Number);
  if (after.every((value, index) => value === before[index]))
    throw new Error(`version is already ${next}`);
  for (let index = 0; index < 3; index += 1) {
    if (after[index] > before[index]) return next;
    if (after[index] < before[index]) break;
  }
  throw new Error(`next version must be greater than ${current}`);
}

function verifyVersions(root, expected) {
  for (const file of VERSION_FILES) {
    const value = readJson(path.join(root, file), file);
    const version = value.version || value.plugins?.[0]?.version;
    if (version !== expected)
      throw new Error(`${file} has version ${version}; expected ${expected}`);
  }
}

function validateIntent(intent, session, branch) {
  if (
    intent.schema_version !== 1 ||
    intent.run_id !== session.run_id ||
    intent.branch !== branch ||
    !/^\d+\.\d+\.\d+$/.test(intent.current_version || "") ||
    !/^\d+\.\d+\.\d+$/.test(intent.next_version || "") ||
    intent.tag !== `v${intent.next_version}`
  ) {
    throw new Error("prepare intent does not match the current session");
  }
}

function githubRepository(url) {
  const patterns = [
    /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/,
    /^ssh:\/\/git@github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/,
    /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return `${match[1]}/${match[2]}`;
  }
  throw new Error("delivery remote is not a supported GitHub repository URL");
}

function isClean(root) {
  return git(root, ["status", "--porcelain", "--untracked-files=no"]) === "";
}

function privatePath(root, value, label) {
  if (!value) throw new Error(`${label} path is required`);
  const resolved = path.resolve(root, value);
  const privateRoot = path.join(root, ".pm");
  if (resolved !== privateRoot && !resolved.startsWith(`${privateRoot}${path.sep}`)) {
    throw new Error(`${label} must be beneath .pm/`);
  }
  return resolved;
}

function intentFile(transactionPath) {
  return path.join(path.dirname(transactionPath), "prepare-intent.json");
}

function removeIntent(transactionPath) {
  fs.rmSync(intentFile(transactionPath), { force: true });
}

function digest(filePath) {
  return digestText(fs.readFileSync(filePath));
}

function digestText(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`cannot read ${label} ${filePath}: ${error.message}`);
  }
}

function git(root, args) {
  return run(root, "git", args).trim();
}

function run(root, command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `${path.basename(command)} ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`
    );
  }
  return result.stdout;
}

function relative(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join("/");
}

function main(argv = process.argv.slice(2)) {
  try {
    const result = prepareRelease(parseArgs(argv));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`prepare-release: ${error.message}\n`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = {
  VERSION_FILES,
  githubRepository,
  main,
  nextVersionFor,
  parseArgs,
  prepareRelease,
};
