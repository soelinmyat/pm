"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { readDescriptorBounded } = require("./bounded-descriptor-read");

function projectPath(root, relativePath) {
  if (
    typeof relativePath !== "string" ||
    relativePath.length === 0 ||
    path.isAbsolute(relativePath) ||
    relativePath.split(/[\\/]+/).some((part) => part === "..")
  )
    throw new Error("project path must be project-relative without traversal");

  const projectRoot = fs.realpathSync(path.resolve(root));
  const absolute = path.resolve(projectRoot, relativePath);
  const relation = path.relative(projectRoot, absolute);
  if (relation === "" || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation))
    throw new Error("project path escapes project root");

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

function snapshotComponents(projectRoot, relation, absolute) {
  const components = [];
  let current = projectRoot;
  const rootStat = fs.lstatSync(projectRoot, { bigint: true });
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory())
    throw new Error(`project root is not a real directory: ${projectRoot}`);
  components.push({ path: projectRoot, stat: rootStat });
  for (const part of relation.split(path.sep)) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current, { bigint: true });
    if (stat.isSymbolicLink()) throw new Error(`project path contains symlink: ${current}`);
    if (current !== absolute && !stat.isDirectory())
      throw new Error(`project path ancestor is not a directory: ${current}`);
    components.push({ path: current, stat });
  }
  return components;
}

function sameComponentIdentities(expected, observed) {
  return (
    expected.length === observed.length &&
    expected.every(
      (component, index) =>
        component.path === observed[index].path &&
        sameComponentMetadata(component.stat, observed[index].stat) &&
        component.stat.isDirectory() === observed[index].stat.isDirectory() &&
        component.stat.isFile() === observed[index].stat.isFile()
    )
  );
}

function sameComponentMetadata(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.uid === right.uid &&
    left.gid === right.gid &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

function stablePathIdentity(components) {
  return JSON.stringify(
    components.map(({ path: componentPath, stat }) => [
      componentPath,
      stat.dev.toString(),
      stat.ino.toString(),
      stat.mode.toString(),
      stat.nlink.toString(),
      stat.uid.toString(),
      stat.gid.toString(),
      stat.size.toString(),
      stat.mtimeNs.toString(),
      stat.ctimeNs.toString(),
    ])
  );
}

function sameFileMetadata(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

function inspectStableProjectInput(root, relativePath, maxBytes = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
    throw new Error("input byte budget must be a non-negative safe integer");
  const { absolute, projectRoot, relation } = projectPath(root, relativePath);
  const initialComponents = snapshotComponents(projectRoot, relation, absolute);
  const initial = initialComponents.at(-1)?.stat;
  if (!initial?.isFile()) throw new Error("input must be an existing regular file");
  if (initial.size > BigInt(maxBytes)) throw new Error(`input exceeds ${maxBytes}-byte budget`);

  const observedComponents = snapshotComponents(projectRoot, relation, absolute);
  if (!sameComponentIdentities(initialComponents, observedComponents)) {
    throw new Error("input path changed during containment validation");
  }
  return {
    path: absolute,
    relative: relation.split(path.sep).join("/"),
    size: Number(initial.size),
    stablePathIdentity: stablePathIdentity(initialComponents),
  };
}

function readProjectInput(root, relativePath, maxBytes = Number.MAX_SAFE_INTEGER, options = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
    throw new Error("input byte budget must be a non-negative safe integer");
  const { absolute, projectRoot, relation } = projectPath(root, relativePath);
  const requireStablePath = options.requireStablePath === true;
  const initialComponents = requireStablePath
    ? snapshotComponents(projectRoot, relation, absolute)
    : null;
  const initial = initialComponents?.at(-1)?.stat;
  if (requireStablePath) {
    if (!initial?.isFile()) throw new Error("input must be an existing regular file");
    if (initial.size > BigInt(maxBytes)) throw new Error(`input exceeds ${maxBytes}-byte budget`);
  } else {
    inspectComponents(projectRoot, relation, absolute);
  }
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
  let descriptor;
  try {
    descriptor = fs.openSync(absolute, flags);
    const opened = fs.fstatSync(descriptor, requireStablePath ? { bigint: true } : undefined);
    if (!opened.isFile()) throw new Error("input must be an existing regular file");
    if (opened.size > (requireStablePath ? BigInt(maxBytes) : maxBytes))
      throw new Error(`input exceeds ${maxBytes}-byte budget`);

    if (requireStablePath) {
      if (!sameFileMetadata(initial, opened))
        throw new Error("input changed during containment validation");
      const openedComponents = snapshotComponents(projectRoot, relation, absolute);
      const openedPath = openedComponents.at(-1)?.stat;
      if (
        !sameComponentIdentities(initialComponents, openedComponents) ||
        !openedPath?.isFile() ||
        !sameFileMetadata(opened, openedPath)
      )
        throw new Error("input changed during containment validation");
    } else {
      const current = inspectComponents(projectRoot, relation, absolute);
      if (!current || !current.isFile()) throw new Error("input must be an existing regular file");
      if (opened.dev !== current.dev || opened.ino !== current.ino)
        throw new Error("input changed during containment validation");
    }

    const bytes = readDescriptorBounded(descriptor, maxBytes);
    if (requireStablePath) {
      const after = fs.fstatSync(descriptor, { bigint: true });
      if (!sameFileMetadata(opened, after)) throw new Error("input changed during bounded read");
      const finalComponents = snapshotComponents(projectRoot, relation, absolute);
      const finalPath = finalComponents.at(-1)?.stat;
      if (
        !sameComponentIdentities(initialComponents, finalComponents) ||
        !finalPath?.isFile() ||
        !sameFileMetadata(after, finalPath)
      )
        throw new Error("input path changed during bounded read");
    }
    return {
      path: absolute,
      relative: relation.split(path.sep).join("/"),
      bytes,
      ...(requireStablePath ? { stablePathIdentity: stablePathIdentity(initialComponents) } : {}),
    };
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

module.exports = { inspectStableProjectInput, readProjectInput };
