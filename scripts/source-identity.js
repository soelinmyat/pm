"use strict";

const { runGit } = require("./loop-git.js");

function deliveryUrl(gitRoot, remoteName) {
  try {
    const pushUrls = runGit(["remote", "get-url", "--push", "--all", "--", remoteName], gitRoot)
      .split(/\r?\n/)
      .filter(Boolean);
    return pushUrls.length === 1 ? pushUrls[0] : "";
  } catch {
    return "";
  }
}

function resolveDeliveryRemote(gitRoot, branch = "") {
  if (!gitRoot) return "";
  const currentBranch = branch || runGit(["branch", "--show-current"], gitRoot);
  const candidates = [];
  if (currentBranch) candidates.push(["branch", currentBranch, "pushRemote"]);
  candidates.push(["remote", "pushDefault"]);
  if (currentBranch) candidates.push(["branch", currentBranch, "remote"]);
  for (const parts of candidates) {
    try {
      const value = runGit(["config", "--get", parts.join(".")], gitRoot).trim();
      if (value && deliveryUrl(gitRoot, value)) return value;
    } catch {
      // Try the next configured source.
    }
  }
  try {
    return deliveryUrl(gitRoot, "origin") ? "origin" : "";
  } catch {
    return "";
  }
}

function sourceRepository(gitRoot, remoteName = "origin") {
  if (!gitRoot) return "";
  let remote;
  try {
    remote = deliveryUrl(gitRoot, remoteName);
    if (!remote) return "";
  } catch {
    return "";
  }
  const text = String(remote).trim();
  const scp = text.match(
    /^(?:[^@\s]+@)?github\.com:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/i
  );
  if (scp) return scp[1].replace(/\.git$/, "");
  try {
    const parsed = new URL(text);
    if (parsed.hostname.toLowerCase() !== "github.com") return "";
    const match = parsed.pathname.match(/^\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/);
    return match ? match[1].replace(/\.git$/, "") : "";
  } catch {
    return "";
  }
}

function defaultBranchName(gitRoot, remoteName = "origin") {
  if (!gitRoot) return "";
  try {
    const remote = deliveryUrl(gitRoot, remoteName);
    if (!remote) return "";
    const output = runGit(["ls-remote", "--symref", "--", remote, "HEAD"], gitRoot);
    const match = output.match(/^ref:\s+refs\/heads\/([^\s]+)\s+HEAD$/m);
    return match && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,200}$/.test(match[1]) ? match[1] : "";
  } catch {
    return "";
  }
}

module.exports = {
  defaultBranchName,
  resolveDeliveryRemote,
  sourceRepository,
};
