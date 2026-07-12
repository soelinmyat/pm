"use strict";

const fs = require("node:fs");
const path = require("node:path");

function projectPath(root, relativePath) {
  if (
    typeof relativePath !== "string" ||
    relativePath.length === 0 ||
    path.isAbsolute(relativePath) ||
    relativePath.split(/[\\/]+/).some((part) => part === "..")
  )
    throw new Error("output path must be project-relative without traversal");

  const projectRoot = fs.realpathSync(path.resolve(root));
  const absolute = path.resolve(projectRoot, relativePath);
  const relation = path.relative(projectRoot, absolute);
  if (relation === "" || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation))
    throw new Error("output path escapes project root");

  return { absolute, projectRoot, relation };
}

function inspectComponents(projectRoot, relation, absolute) {
  let current = projectRoot;
  let finalStat = null;
  for (const part of relation.split(path.sep)) {
    current = path.join(current, part);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error.code === "ENOENT") {
        finalStat = null;
        continue;
      }
      throw error;
    }
    if (stat.isSymbolicLink()) throw new Error(`project path contains symlink: ${current}`);
    if (current !== absolute && !stat.isDirectory())
      throw new Error(`project path ancestor is not a directory: ${current}`);
    finalStat = stat;
  }
  return finalStat;
}

function safeProjectOutput(root, relativePath) {
  const { absolute, projectRoot, relation } = projectPath(root, relativePath);
  inspectComponents(projectRoot, relation, absolute);
  return absolute;
}

function safeProjectInput(root, relativePath) {
  const { absolute, projectRoot, relation } = projectPath(root, relativePath);
  const stat = inspectComponents(projectRoot, relation, absolute);
  if (!stat || !stat.isFile()) throw new Error("input must be an existing regular file");
  return absolute;
}

module.exports = { safeProjectInput, safeProjectOutput };
