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

function readProjectInput(root, relativePath, maxBytes = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
    throw new Error("input byte budget must be a non-negative safe integer");
  const { absolute, projectRoot, relation } = projectPath(root, relativePath);
  inspectComponents(projectRoot, relation, absolute);
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
  let descriptor;
  try {
    descriptor = fs.openSync(absolute, flags);
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile()) throw new Error("input must be an existing regular file");
    if (opened.size > maxBytes) throw new Error(`input exceeds ${maxBytes}-byte budget`);

    const current = inspectComponents(projectRoot, relation, absolute);
    if (!current || !current.isFile()) throw new Error("input must be an existing regular file");
    if (opened.dev !== current.dev || opened.ino !== current.ino)
      throw new Error("input changed during containment validation");

    return {
      path: absolute,
      relative: relation.split(path.sep).join("/"),
      bytes: readDescriptorBounded(descriptor, maxBytes),
    };
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function readDescriptorBounded(descriptor, maxBytes) {
  const chunks = [];
  let total = 0;
  while (true) {
    const remaining = maxBytes - total;
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, remaining + 1));
    const count = fs.readSync(descriptor, buffer, 0, buffer.length, null);
    if (count === 0) break;
    total += count;
    if (total > maxBytes) throw new Error(`input exceeds ${maxBytes}-byte budget`);
    chunks.push(buffer.subarray(0, count));
  }
  return Buffer.concat(chunks, total);
}

module.exports = { readProjectInput, safeProjectInput, safeProjectOutput };
