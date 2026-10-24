"use strict";

const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");

function cleanSourceIdentity(root, label = "trusted product UI capture") {
  const git = (args, encoding = "utf8") =>
    execFileSync("git", args, {
      cwd: root,
      encoding,
      timeout: 10_000,
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  const [head, tree] = git(["rev-parse", "HEAD", "HEAD^{tree}"]).trim().split(/\s+/);
  if (![head, tree].every((value) => /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value || "")))
    throw new Error("current Git source identity is invalid");
  const status = git(["status", "--porcelain=v1", "-z", "--untracked-files=no"], null);
  if (status.length) throw new Error(`tracked source must be clean before ${label}`);
  return {
    head,
    tree,
    tracked_status_sha256: crypto.createHash("sha256").update(status).digest("hex"),
    clean: true,
  };
}

module.exports = { cleanSourceIdentity };
