"use strict";

const { runGit } = require("./loop-git.js");

function sourceRepository(gitRoot) {
  if (!gitRoot) return "";
  let remote;
  try {
    remote = runGit(["remote", "get-url", "origin"], gitRoot);
  } catch {
    return "";
  }
  const match = String(remote).match(
    /(?:github\.com[/:]|^[^/]+\/)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/
  );
  return match ? match[1].replace(/\.git$/, "") : "";
}

function defaultBranchName(gitRoot) {
  if (!gitRoot) return "";
  try {
    const output = runGit(["ls-remote", "--symref", "origin", "HEAD"], gitRoot);
    const match = output.match(/^ref:\s+refs\/heads\/([^\s]+)\s+HEAD$/m);
    return match && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,200}$/.test(match[1]) ? match[1] : "";
  } catch {
    return "";
  }
}

module.exports = {
  defaultBranchName,
  sourceRepository,
};
