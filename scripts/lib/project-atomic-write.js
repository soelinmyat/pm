"use strict";

const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { readProjectInput } = require("./safe-project-output");

function writeProjectFileAtomic(root, relativePath, content, options = {}) {
  const projectRoot = fs.realpathSync(path.resolve(root));
  validateRelative(relativePath);
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(String(content));
  const maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || bytes.length > maxBytes)
    throw new Error(`output exceeds ${maxBytes}-byte budget`);
  const rootStat = fs.statSync(projectRoot);
  if (typeof options.beforeSpawn === "function") options.beforeSpawn();
  const result = spawnSync(
    process.execPath,
    [
      __filename,
      "--child",
      relativePath,
      String(options.fileMode ?? 0o666),
      String(options.directoryMode ?? 0o777),
      options.replace === false ? "exclusive" : "replace",
      String(rootStat.dev),
      String(rootStat.ino),
    ],
    {
      cwd: projectRoot,
      input: bytes,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    }
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error((result.stderr || result.stdout || "project output write failed").trim());
  const state = JSON.parse(result.stdout || "{}");
  if (state.committed !== true) throw new Error("project output child omitted committed state");
  try {
    const attested = readProjectInput(projectRoot, relativePath, maxBytes);
    if (!attested.bytes.equals(bytes))
      throw new Error("committed bytes do not match requested output");
  } catch (error) {
    const failure = new Error(
      `project output committed but path attestation failed: ${error.message}`
    );
    failure.committed = true;
    throw failure;
  }
  return { path: path.resolve(projectRoot, relativePath), ...state };
}

function writeProjectJsonAtomic(root, relativePath, value, options = {}) {
  return writeProjectFileAtomic(root, relativePath, `${JSON.stringify(value, null, 2)}\n`, options);
}

function writeProjectTextAtomic(root, relativePath, value, options = {}) {
  return writeProjectFileAtomic(root, relativePath, String(value), options);
}

function writeFromAnchoredRoot(relativePath, content, options = {}) {
  validateRelative(relativePath);
  const rootStat = fs.statSync(".");
  if (
    options.expectedRootDev !== undefined &&
    (String(rootStat.dev) !== String(options.expectedRootDev) ||
      String(rootStat.ino) !== String(options.expectedRootIno))
  )
    throw new Error("project root changed before anchored output write");

  const parts = relativePath.split(/[\\/]+/);
  const basename = parts.pop();
  for (const part of parts) enterDirectory(part, options.directoryMode ?? 0o777);

  const temporary = `.${basename}.tmp-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
  let descriptor;
  let committed = false;
  try {
    descriptor = fs.openSync(
      temporary,
      fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        (fs.constants.O_NOFOLLOW || 0),
      options.fileMode ?? 0o666
    );
    const opened = fs.fstatSync(descriptor);
    fs.writeFileSync(descriptor, content);
    fs.fsyncSync(descriptor);
    if (typeof options.beforeCommit === "function") options.beforeCommit();
    if (options.replace === false) {
      fs.linkSync(temporary, basename);
    } else fs.renameSync(temporary, basename);
    committed = true;
    const finalStat = fs.lstatSync(basename);
    if (
      finalStat.isSymbolicLink() ||
      !finalStat.isFile() ||
      finalStat.dev !== opened.dev ||
      finalStat.ino !== opened.ino
    ) {
      fs.rmSync(basename, { force: true });
      throw new Error("project output changed during atomic commit");
    }
    if (options.replace === false) fs.unlinkSync(temporary);
    fs.closeSync(descriptor);
    descriptor = undefined;
    const durability = fsyncDirectory();
    return {
      committed: true,
      directory_synced: durability.synced,
      ...(durability.errorCode ? { directory_sync_error: durability.errorCode } : {}),
    };
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(temporary, { force: true });
    if (committed && /changed during atomic commit/.test(error.message))
      fs.rmSync(basename, { force: true });
    throw error;
  }
}

function enterDirectory(component, mode) {
  let expected;
  try {
    expected = fs.lstatSync(component);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    fs.mkdirSync(component, { mode });
    expected = fs.lstatSync(component);
  }
  if (expected.isSymbolicLink() || !expected.isDirectory())
    throw new Error(`project output ancestor is not a real directory: ${component}`);
  process.chdir(component);
  const entered = fs.statSync(".");
  if (entered.dev !== expected.dev || entered.ino !== expected.ino)
    throw new Error(`project output ancestor changed during descent: ${component}`);
}

function fsyncDirectory() {
  let descriptor;
  let outcome = { synced: false, errorCode: "UNKNOWN" };
  try {
    descriptor = fs.openSync(".", fs.constants.O_RDONLY);
    fs.fsyncSync(descriptor);
    outcome = { synced: true };
  } catch (error) {
    // The file and rename are already durable at the file-descriptor level.
    // Directory fsync support varies by platform, so surface its durability
    // state without converting a completed commit into a retryable failure.
    outcome = { synced: false, errorCode: error.code || "UNKNOWN" };
  } finally {
    if (descriptor !== undefined)
      try {
        fs.closeSync(descriptor);
      } catch (error) {
        outcome = { synced: false, errorCode: error.code || "UNKNOWN" };
      }
  }
  return outcome;
}

function validateRelative(relativePath) {
  if (
    typeof relativePath !== "string" ||
    relativePath.length === 0 ||
    path.isAbsolute(relativePath) ||
    relativePath.split(/[\\/]+/).some((part) => !part || part === "." || part === "..")
  )
    throw new Error("output path must be project-relative without traversal");
}

function childMain(argv) {
  try {
    const [, relativePath, fileMode, directoryMode, policy, expectedRootDev, expectedRootIno] =
      argv;
    if (!new Set(["replace", "exclusive"]).has(policy)) throw new Error("invalid write policy");
    const content = fs.readFileSync(0);
    const state = writeFromAnchoredRoot(relativePath, content, {
      fileMode: Number(fileMode),
      directoryMode: Number(directoryMode),
      replace: policy === "replace",
      expectedRootDev,
      expectedRootIno,
    });
    process.stdout.write(`${JSON.stringify(state)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 1;
  }
}

if (require.main === module) process.exitCode = childMain(process.argv.slice(2));

module.exports = {
  writeProjectFileAtomic,
  writeProjectJsonAtomic,
  writeProjectTextAtomic,
};
