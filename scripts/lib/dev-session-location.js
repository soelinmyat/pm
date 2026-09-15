"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { gitExec } = require("./git-env");
const { readProjectInput } = require("./safe-project-output");
const { MAX_JSON_BYTES } = require("./review-limits");

// Session state stays at its originating worktree. Only that single file may
// cross the source-root boundary; evidence and output paths remain local.
function loadDevSession(root, { slug, sessionPath } = {}) {
  root = fs.realpathSync(path.resolve(root));
  let requested = sessionPath ? path.resolve(root, sessionPath) : null;
  const match = requested
    ?.replaceAll("\\", "/")
    .match(/\/\.pm\/dev-sessions\/([a-z0-9]+(?:-[a-z0-9]+)*)\/session\.json$/);
  if (requested && !match)
    throw new Error("Dev session path must be the canonical sibling session.json");
  if (slug && match && slug !== match[1])
    throw new Error(`Dev session slug must equal target namespace ${slug}`);
  slug ||= match?.[1];
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug || ""))
    throw new Error("Dev session requires a valid slug");
  const relative = `.pm/dev-sessions/${slug}/session.json`;
  if (requested)
    requested = path.join(
      fs.realpathSync(path.resolve(path.dirname(requested), "../../..")),
      relative
    );
  const local = path.join(root, relative);
  if ((!requested || requested === local) && fs.existsSync(local)) {
    const loaded = readSession(root, relative);
    if (loaded.value.source?.repo_root && fs.realpathSync(loaded.value.source.repo_root) !== root)
      throw new Error("Noncanonical session copy: retain the originating session instead");
    return loaded;
  }
  const roots = gitExec(root, ["worktree", "list", "--porcelain", "-z"])
    .split("\0")
    .filter((row) => row.startsWith("worktree "))
    .map((row) => row.slice(9));
  const common = commonDirectory(root);
  const matches = [];
  for (const candidate of roots) {
    if (
      candidate === root ||
      (requested && requested !== local && requested !== path.join(candidate, relative))
    )
      continue;
    const file = path.join(candidate, relative);
    try {
      fs.lstatSync(file);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    if (commonDirectory(candidate) !== common) throw new Error("Dev session repository mismatch");
    let loaded;
    try {
      loaded = readSession(candidate, relative);
    } catch (error) {
      // Discovery must not follow another worktree's symlinked state. Such a
      // path cannot be an authority candidate; an explicit request still fails.
      if (!requested || requested === local) continue;
      throw error;
    }
    const session = loaded.value;
    if (requested && requested !== local && path.resolve(file) !== requested) continue;
    if (!requested || requested === local) {
      if (path.resolve(session.source?.worktree || "") !== root) continue;
    }
    const issues = require("./dev-session-schema").validateSession(session);
    if (issues.length) throw new Error("Originating Dev session is invalid");
    if (
      session.slug !== slug ||
      fs.realpathSync(session.source.repo_root) !== fs.realpathSync(candidate) ||
      fs.realpathSync(session.source.worktree) !== root ||
      session.source.branch !== gitExec(root, ["branch", "--show-current"]).trim()
    )
      throw new Error(
        "Originating Dev session does not match source worktree, branch or namespace"
      );
    matches.push(loaded);
  }
  if (matches.length !== 1)
    throw new Error("Expected one canonical Dev session in this repository's registered worktrees");
  return matches[0];
}

function commonDirectory(root) {
  return fs.realpathSync(
    path.resolve(root, gitExec(root, ["rev-parse", "--git-common-dir"]).trim())
  );
}

function readSession(root, relative) {
  const file = readProjectInput(root, relative, MAX_JSON_BYTES);
  return { path: path.join(root, relative), value: JSON.parse(file.bytes.toString("utf8")) };
}

if (require.main === module) {
  try {
    const [root, slug] = process.argv.slice(2);
    if (!root || !slug || process.argv.length !== 4)
      throw new Error("Usage: dev-session-location <root> <slug>");
    process.stdout.write(`${loadDevSession(root, { slug }).path}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { loadDevSession };
