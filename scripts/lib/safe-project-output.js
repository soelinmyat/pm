"use strict";

const fs = require("node:fs");
const path = require("node:path");

function safeProjectOutput(root, relativePath) {
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

  let current = projectRoot;
  for (const part of relation.split(path.sep)) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) continue;
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(`output path contains symlink: ${current}`);
    if (current !== absolute && !stat.isDirectory())
      throw new Error(`output ancestor is not a directory: ${current}`);
  }
  return absolute;
}

module.exports = { safeProjectOutput };
