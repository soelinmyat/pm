"use strict";

const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { readProjectInput } = require("./safe-project-output");

const UNSUPPORTED_DIRECTORY_SYNC_ERRORS = new Set([
  "EBADF",
  "EINVAL",
  "EISDIR",
  "ENOSYS",
  "ENOTSUP",
  "EPERM",
]);

function writeProjectFileAtomic(root, relativePath, content, options = {}) {
  const projectRoot = fs.realpathSync(path.resolve(root));
  validateRelative(relativePath);
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(String(content));
  const maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || bytes.length > maxBytes)
    throw new Error(`output exceeds ${maxBytes}-byte budget`);
  const rootStat = fs.statSync(projectRoot);
  const attestations = normalizeAttestations(options.attestations || []);
  const finalAttestation = options.finalAttestation
    ? normalizeAttestations([options.finalAttestation])[0]
    : null;
  if (finalAttestation && finalAttestation.path !== relativePath)
    throw new Error("atomic write final attestation must target the output path");
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
      Buffer.from(JSON.stringify(attestations)).toString("base64"),
      Buffer.from(JSON.stringify(finalAttestation)).toString("base64"),
    ],
    {
      cwd: projectRoot,
      input: bytes,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    }
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    let childState = null;
    try {
      childState = JSON.parse(result.stdout || "null");
    } catch {
      // Preserve the ordinary child failure below.
    }
    if (childState?.committed === true) {
      const failure = new Error(
        childState.message ||
          "project output committed but child cleanup failed; do not retry this write"
      );
      failure.committed = true;
      if (childState.error_code) failure.code = childState.error_code;
      throw failure;
    }
    throw new Error((result.stderr || result.stdout || "project output write failed").trim());
  }
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
  if (
    state.directory_synced === false &&
    !UNSUPPORTED_DIRECTORY_SYNC_ERRORS.has(state.directory_sync_error)
  ) {
    const failure = new Error(
      `project output committed but directory sync failed (${state.directory_sync_error || "UNKNOWN"}); do not retry this write`
    );
    failure.committed = true;
    failure.directorySyncError = state.directory_sync_error || "UNKNOWN";
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
  const projectRoot = fs.realpathSync(".");
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
    const anchoredRoot = fs.statSync(projectRoot);
    if (anchoredRoot.dev !== rootStat.dev || anchoredRoot.ino !== rootStat.ino)
      throw new Error("project root changed before input attestation");
    attestProjectInputs(projectRoot, options.attestations || []);
    if (typeof options.beforeCommit === "function") options.beforeCommit();
    if (options.finalAttestation)
      attestProjectInputs(".", [{ ...options.finalAttestation, path: basename }]);
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
    let cleanupError = null;
    if (descriptor !== undefined)
      try {
        fs.closeSync(descriptor);
      } catch (closeError) {
        cleanupError = closeError;
      }
    try {
      fs.rmSync(temporary, { force: true });
    } catch (removeError) {
      cleanupError ||= removeError;
    }
    if (committed && /changed during atomic commit/.test(error.message)) {
      try {
        fs.rmSync(basename, { force: true });
      } catch (removeError) {
        cleanupError ||= removeError;
      }
      if (!cleanupError) throw error;
    }
    if (committed) {
      const cause = cleanupError || error;
      const failure = new Error(
        `project output committed but cleanup failed (${cause.code || "UNKNOWN"}); do not retry this write`
      );
      failure.committed = true;
      failure.code = cause.code || "UNKNOWN";
      throw failure;
    }
    if (cleanupError) throw cleanupError;
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

function normalizeAttestations(attestations) {
  if (!Array.isArray(attestations) || attestations.length > 32)
    throw new Error("atomic write attestations must be an array of at most 32 entries");
  const seen = new Set();
  return attestations.map((attestation) => {
    if (
      !attestation ||
      typeof attestation !== "object" ||
      Array.isArray(attestation) ||
      Object.keys(attestation).some((field) => !["path", "sha256", "maxBytes"].includes(field))
    )
      throw new Error("atomic write attestation is invalid");
    validateRelative(attestation.path);
    if (seen.has(attestation.path))
      throw new Error("atomic write attestation paths must be unique");
    seen.add(attestation.path);
    if (!/^sha256:[a-f0-9]{64}$/.test(attestation.sha256 || ""))
      throw new Error("atomic write attestation sha256 is invalid");
    if (!Number.isSafeInteger(attestation.maxBytes) || attestation.maxBytes < 0)
      throw new Error("atomic write attestation maxBytes is invalid");
    return {
      path: attestation.path,
      sha256: attestation.sha256,
      maxBytes: attestation.maxBytes,
    };
  });
}

function attestProjectInputs(root, attestations) {
  for (const attestation of normalizeAttestations(attestations)) {
    const input = readProjectInput(root, attestation.path, attestation.maxBytes);
    const observed = `sha256:${crypto.createHash("sha256").update(input.bytes).digest("hex")}`;
    if (observed !== attestation.sha256)
      throw new Error(`atomic write attestation changed: ${attestation.path}`);
  }
}

function childMain(argv) {
  try {
    const [
      ,
      relativePath,
      fileMode,
      directoryMode,
      policy,
      expectedRootDev,
      expectedRootIno,
      attestationsBase64,
      finalAttestationBase64,
    ] = argv;
    if (!new Set(["replace", "exclusive"]).has(policy)) throw new Error("invalid write policy");
    const content = fs.readFileSync(0);
    const state = writeFromAnchoredRoot(relativePath, content, {
      fileMode: Number(fileMode),
      directoryMode: Number(directoryMode),
      replace: policy === "replace",
      expectedRootDev,
      expectedRootIno,
      attestations: JSON.parse(
        Buffer.from(attestationsBase64 || "W10=", "base64").toString("utf8")
      ),
      finalAttestation: JSON.parse(
        Buffer.from(finalAttestationBase64 || "bnVsbA==", "base64").toString("utf8")
      ),
    });
    process.stdout.write(`${JSON.stringify(state)}\n`);
    return 0;
  } catch (error) {
    if (error.committed === true) {
      process.stdout.write(
        `${JSON.stringify({ committed: true, message: error.message, error_code: error.code || "UNKNOWN" })}\n`
      );
    } else process.stderr.write(`${error.message}\n`);
    return 1;
  }
}

if (require.main === module) process.exitCode = childMain(process.argv.slice(2));

module.exports = {
  writeProjectFileAtomic,
  writeProjectJsonAtomic,
  writeProjectTextAtomic,
};
