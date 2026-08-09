#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { runGit } = require("./loop-git.js");
const { acquireOwnedLock } = require("./lib/owned-lock.js");
const {
  defaultBranchNameFromUrl,
  deliveryUrl,
  resolveDeliveryRemote,
} = require("./source-identity.js");

const KINDS = new Set(["groom", "rfc"]);

function git(cwd, args) {
  return runGit(args, cwd, { timeout: 30_000 });
}

function gitMaybe(cwd, args) {
  try {
    return { ok: true, output: git(cwd, args) };
  } catch (error) {
    return { ok: false, output: "", error: error.stderr || error.message || String(error) };
  }
}

function normalizeSlug(value) {
  const slug = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (!slug) throw new Error("artifact worktree slug is required");
  return slug;
}

function selectRemote(repoRoot, artifactBranch = "") {
  const remotes = git(repoRoot, ["remote"])
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
  const configured = resolveDeliveryRemote(repoRoot, artifactBranch);
  if (configured && remotes.includes(configured)) return configured;
  if (remotes.includes("origin")) return "origin";
  if (remotes.length === 1) return remotes[0];
  if (remotes.length === 0) throw new Error("artifact repository has no Git remote");
  throw new Error(
    `artifact repository has multiple remotes (${remotes.join(", ")}) and no origin; configure one authoritative remote`
  );
}

function remoteUrlHash(remoteUrl) {
  return crypto.createHash("sha256").update(remoteUrl).digest("hex");
}

function artifactBranch(slug, kind) {
  const normalized = normalizeSlug(slug);
  return `codex/${normalized}-${kind}`;
}

function groomHandoffBase(observedRoot, worktrees, slug) {
  const branch = artifactBranch(slug, "groom");
  const registered = worktrees.find((item) => item.branch === branch);
  if (!registered) return null;
  const ownership = verifyArtifactWorktreeOwnership({
    worktree: registered.path,
    slug,
    kind: "groom",
  });
  if (git(ownership.worktree, ["status", "--porcelain=v1"])) {
    throw new Error(
      `Groom artifact worktree '${branch}' has uncommitted changes; commit the approved proposal before RFC handoff`
    );
  }
  return {
    branch,
    commit: git(ownership.worktree, ["rev-parse", "HEAD"]),
  };
}

function resolveRemoteDefaultBranch(repoRoot, remote, remoteUrl = deliveryUrl(repoRoot, remote)) {
  if (!remoteUrl) throw new Error(`could not resolve ${remote}'s authoritative push URL`);
  const branch = defaultBranchNameFromUrl(repoRoot, remoteUrl);
  if (!branch) throw new Error(`could not resolve ${remote}'s default branch`);
  git(repoRoot, [
    "fetch",
    "--no-tags",
    remoteUrl,
    `refs/heads/${branch}:refs/remotes/${remote}/${branch}`,
  ]);
  return branch;
}

function parseWorktrees(output) {
  const records = [];
  let current = null;
  for (const line of `${output}\n`.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current) records.push(current);
      current = { path: line.slice("worktree ".length), branch: null };
    } else if (current && line.startsWith("branch refs/heads/")) {
      current.branch = line.slice("branch refs/heads/".length);
    } else if (current && line === "") {
      records.push(current);
      current = null;
    }
  }
  return records;
}

function verifyArtifactWorktreeOwnership(options) {
  if (!KINDS.has(options?.kind)) throw new Error("artifact worktree kind must be groom or rfc");
  const worktree = fs.realpathSync(path.resolve(options.worktree));
  const repoRoot = fs.realpathSync(git(worktree, ["rev-parse", "--show-toplevel"]));
  if (repoRoot !== worktree) throw new Error("artifact_repo_root must be a Git worktree root");
  const branch = artifactBranch(options.slug, options.kind);
  if (git(worktree, ["branch", "--show-current"]) !== branch)
    throw new Error(`artifact_repo_root must use helper-owned branch '${branch}'`);
  const required = {
    base_commit: gitMaybe(worktree, ["config", "--get", `branch.${branch}.pmArtifactBase`]),
    kind: gitMaybe(worktree, ["config", "--get", `branch.${branch}.pmArtifactKind`]),
    remote: gitMaybe(worktree, ["config", "--get", `branch.${branch}.pmArtifactRemote`]),
    default_branch: gitMaybe(worktree, [
      "config",
      "--get",
      `branch.${branch}.pmArtifactDefaultBranch`,
    ]),
    remote_url_sha256: gitMaybe(worktree, [
      "config",
      "--get",
      `branch.${branch}.pmArtifactRemoteUrlSha256`,
    ]),
  };
  if (Object.values(required).some((item) => !item.ok) || required.kind.output !== options.kind)
    throw new Error("artifact_repo_root is not marked as a complete helper-owned worktree");
  const configuredUrl = deliveryUrl(worktree, required.remote.output);
  if (!configuredUrl || remoteUrlHash(configuredUrl) !== required.remote_url_sha256.output)
    throw new Error("artifact_repo_root delivery URL identity changed after preparation");
  const registered = parseWorktrees(git(worktree, ["worktree", "list", "--porcelain"])).find(
    (item) => item.branch === branch && fs.realpathSync(item.path) === worktree
  );
  if (!registered) throw new Error("artifact_repo_root is not the registered owned worktree");
  return {
    worktree,
    branch,
    base_commit: required.base_commit.output,
    remote: required.remote.output,
    default_branch: required.default_branch.output,
  };
}

function prepareArtifactWorktree(options) {
  if (!options?.pmDir) throw new Error("prepareArtifactWorktree requires pmDir");
  if (!KINDS.has(options.kind)) throw new Error("artifact worktree kind must be groom or rfc");
  const slug = normalizeSlug(options.slug);
  const pmDir = fs.realpathSync(path.resolve(options.pmDir));
  const observedRoot = fs.realpathSync(git(pmDir, ["rev-parse", "--show-toplevel"]));
  const contentRelative = path.relative(observedRoot, pmDir);
  if (contentRelative === ".." || contentRelative.startsWith(`..${path.sep}`)) {
    throw new Error("PM content directory escapes its Git repository");
  }

  const initialWorktrees = parseWorktrees(git(observedRoot, ["worktree", "list", "--porcelain"]));
  if (initialWorktrees.length === 0)
    throw new Error("artifact repository has no registered Git worktree");
  const mainWorktree = fs.realpathSync(initialWorktrees[0].path);
  const branch = artifactBranch(slug, options.kind);
  git(observedRoot, ["check-ref-format", "--branch", branch]);
  const artifactRoot = path.join(
    path.dirname(mainWorktree),
    ".worktrees",
    path.basename(mainWorktree)
  );
  const target = path.join(artifactRoot, branch);
  const lockPath = path.join(artifactRoot, ".locks", "prepare.lock");
  const releaseLock = acquireOwnedLock(lockPath, {
    attempts: 100,
    waitMs: 50,
    timeoutMessage: `another process is preparing artifact branch '${branch}'; retry after it finishes`,
  });
  try {
    const worktrees = parseWorktrees(git(observedRoot, ["worktree", "list", "--porcelain"]));
    const baseKey = `branch.${branch}.pmArtifactBase`;
    const kindKey = `branch.${branch}.pmArtifactKind`;
    const remoteKey = `branch.${branch}.pmArtifactRemote`;
    const defaultKey = `branch.${branch}.pmArtifactDefaultBranch`;
    const urlHashKey = `branch.${branch}.pmArtifactRemoteUrlSha256`;
    const inheritedKey = `branch.${branch}.pmArtifactInheritedFrom`;
    const branchExists = gitMaybe(observedRoot, [
      "show-ref",
      "--verify",
      "--quiet",
      `refs/heads/${branch}`,
    ]).ok;
    const ownedBase = gitMaybe(observedRoot, ["config", "--get", baseKey]);
    const ownedKind = gitMaybe(observedRoot, ["config", "--get", kindKey]);
    const ownedRemote = gitMaybe(observedRoot, ["config", "--get", remoteKey]);
    const ownedDefault = gitMaybe(observedRoot, ["config", "--get", defaultKey]);
    const ownedUrlHash = gitMaybe(observedRoot, ["config", "--get", urlHashKey]);
    const ownedInherited = gitMaybe(observedRoot, ["config", "--get", inheritedKey]);
    if (
      branchExists &&
      (!ownedBase.ok ||
        !ownedKind.ok ||
        ownedKind.output !== options.kind ||
        !ownedRemote.ok ||
        !ownedDefault.ok ||
        !ownedUrlHash.ok)
    ) {
      throw new Error(
        `branch '${branch}' already exists without PM artifact-worktree ownership; preserve it and choose a new slug or recover it manually`
      );
    }
    if (branchExists) {
      const currentUrl = deliveryUrl(observedRoot, ownedRemote.output);
      if (!currentUrl || remoteUrlHash(currentUrl) !== ownedUrlHash.output) {
        throw new Error(
          `artifact worktree '${branch}' was created for a different delivery URL; preserve it and recover the remote configuration before resuming`
        );
      }
    }

    const registered = worktrees.find((item) => item.branch === branch);
    if (registered) {
      const worktree = fs.realpathSync(registered.path);
      const remote = ownedRemote.output;
      const defaultBranch = ownedDefault.output;
      return {
        ok: true,
        reused: true,
        kind: options.kind,
        branch,
        remote,
        default_branch: defaultBranch,
        base_ref: remote && defaultBranch ? `${remote}/${defaultBranch}` : null,
        base_commit: ownedBase.output,
        inherited_from: ownedInherited.ok ? ownedInherited.output : null,
        repo_root: worktree,
        worktree,
        pm_dir: path.join(worktree, contentRelative),
        shared_checkout: mainWorktree,
      };
    }

    if (fs.existsSync(target)) {
      throw new Error(`artifact worktree target already exists but is not registered: ${target}`);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    let createdBranch = false;
    let remote = ownedRemote.ok ? ownedRemote.output : null;
    let defaultBranch = ownedDefault.ok ? ownedDefault.output : null;
    let baseRef = remote && defaultBranch ? `${remote}/${defaultBranch}` : null;
    let baseCommit = ownedBase.ok ? ownedBase.output : null;
    let inheritedFrom = ownedInherited.ok ? ownedInherited.output : null;
    try {
      if (branchExists) {
        git(observedRoot, ["worktree", "add", "--", target, branch]);
      } else {
        remote = selectRemote(observedRoot, branch);
        const remoteUrl = deliveryUrl(observedRoot, remote);
        defaultBranch = resolveRemoteDefaultBranch(observedRoot, remote, remoteUrl);
        baseRef = `${remote}/${defaultBranch}`;
        baseCommit = git(observedRoot, ["rev-parse", "--verify", baseRef]);
        const handoff =
          options.kind === "rfc" ? groomHandoffBase(observedRoot, worktrees, slug) : null;
        if (handoff) {
          baseRef = handoff.branch;
          baseCommit = handoff.commit;
          inheritedFrom = handoff.branch;
        }
        git(observedRoot, ["worktree", "add", "--no-track", "-b", branch, target, baseCommit]);
        createdBranch = true;
        git(observedRoot, ["config", baseKey, baseCommit]);
        git(observedRoot, ["config", kindKey, options.kind]);
        git(observedRoot, ["config", remoteKey, remote]);
        git(observedRoot, ["config", defaultKey, defaultBranch]);
        git(observedRoot, ["config", urlHashKey, remoteUrlHash(remoteUrl)]);
        if (inheritedFrom) git(observedRoot, ["config", inheritedKey, inheritedFrom]);
      }
    } catch (error) {
      gitMaybe(observedRoot, ["worktree", "remove", "--force", "--", target]);
      if (createdBranch) {
        gitMaybe(observedRoot, ["branch", "-D", "--", branch]);
        gitMaybe(observedRoot, ["config", "--unset-all", baseKey]);
        gitMaybe(observedRoot, ["config", "--unset-all", kindKey]);
        gitMaybe(observedRoot, ["config", "--unset-all", remoteKey]);
        gitMaybe(observedRoot, ["config", "--unset-all", defaultKey]);
        gitMaybe(observedRoot, ["config", "--unset-all", urlHashKey]);
        gitMaybe(observedRoot, ["config", "--unset-all", inheritedKey]);
      }
      throw error;
    }
    const worktree = fs.realpathSync(target);
    return {
      ok: true,
      reused: false,
      kind: options.kind,
      branch,
      remote,
      default_branch: defaultBranch,
      base_ref: baseRef,
      base_commit: baseCommit,
      inherited_from: inheritedFrom,
      repo_root: worktree,
      worktree,
      pm_dir: path.join(worktree, contentRelative),
      shared_checkout: mainWorktree,
    };
  } finally {
    releaseLock();
  }
}

function parseArgs(argv) {
  const options = { json: false };
  if (argv[0] !== "prepare")
    throw new Error(
      "usage: artifact-worktree.js prepare --pm-dir <path> --slug <slug> --kind <groom|rfc> [--json]"
    );
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--json") options.json = true;
    else if (["--pm-dir", "--slug", "--kind"].includes(token)) {
      const value = argv[index + 1];
      if (!value) throw new Error(`${token} requires a value`);
      options[token.slice(2).replaceAll("-", "_")] = value;
      index += 1;
    } else throw new Error(`unknown argument: ${token}`);
  }
  return options;
}

if (require.main === module) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = prepareArtifactWorktree({
      pmDir: options.pm_dir,
      slug: options.slug,
      kind: options.kind,
    });
    process.stdout.write(
      options.json ? `${JSON.stringify(result, null, 2)}\n` : `${result.worktree}\n`
    );
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  artifactBranch,
  normalizeSlug,
  parseWorktrees,
  prepareArtifactWorktree,
  resolveRemoteDefaultBranch,
  selectRemote,
  verifyArtifactWorktreeOwnership,
};
