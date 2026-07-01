"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function safeCopyTree(src, dest) {
  rejectSymlinks(src);
  copyTree(src, dest);
}

function rejectSymlinks(target) {
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink()) {
    throw new Error(`symlink rejected: ${target}`);
  }
  if (!stat.isDirectory()) return;
  for (const entry of fs.readdirSync(target)) {
    rejectSymlinks(path.join(target, entry));
  }
}

function copyTree(src, dest) {
  const stat = fs.lstatSync(src);
  if (stat.isSymbolicLink()) throw new Error(`symlink rejected: ${src}`);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyTree(path.join(src, entry), path.join(dest, entry));
    }
    return;
  }
  if (!stat.isFile()) {
    throw new Error(`unsupported file type: ${src}`);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(dest, stat.mode & 0o777);
}

function hashTree(root) {
  const files = listFiles(root);
  const hash = crypto.createHash("sha256");
  for (const file of files) {
    hash.update(file.path);
    hash.update("\0");
    hash.update(fs.readFileSync(path.join(root, file.path)));
    hash.update("\0");
  }
  return { hash: `sha256:${hash.digest("hex")}`, files };
}

function listFiles(root, base = root) {
  const stat = fs.lstatSync(root);
  if (stat.isSymbolicLink()) throw new Error(`symlink rejected: ${root}`);
  if (stat.isFile()) {
    return [{ path: path.relative(base, root).split(path.sep).join("/"), size: stat.size }];
  }
  if (!stat.isDirectory()) return [];
  return fs
    .readdirSync(root)
    .flatMap((entry) => listFiles(path.join(root, entry), base))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function createSourceIdentity({ sourceRef, branch, dirty, runtimeDir }) {
  return {
    source_ref: sourceRef,
    branch,
    dirty: Boolean(dirty),
    runtime_hash: hashTree(runtimeDir).hash,
    runtime_ref: "runtime/pm",
  };
}

function createScenarioIdentity({ id, scenarioDir }) {
  return {
    id,
    scenario_hash: hashTree(scenarioDir).hash,
    scenario_ref: "scenario",
  };
}

module.exports = {
  safeCopyTree,
  hashTree,
  createSourceIdentity,
  createScenarioIdentity,
};
