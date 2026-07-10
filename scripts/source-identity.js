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
  if (!gitRoot) return "main";
  try {
    return runGit(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], gitRoot).replace(
      /^origin\//,
      ""
    );
  } catch {
    return "main";
  }
}

module.exports = {
  defaultBranchName,
  sourceRepository,
};
