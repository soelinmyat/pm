"use strict";

const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const v8 = require("node:v8");
const { readProjectInput } = require("./safe-project-output");

const UNSUPPORTED_DIRECTORY_SYNC_ERRORS = new Set([
  "EBADF",
  "EINVAL",
  "EISDIR",
  "ENOSYS",
  "ENOTSUP",
  "EPERM",
]);
const MAX_DIRECTORY_FILES = 64;
const DEFAULT_DIRECTORY_MAX_BYTES = 128 * 1024 * 1024;

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

// The directory name is reserved atomically. The required commitFile is written
// last, so readers must ignore a reserved directory until that marker exists.
function writeProjectDirectoryAtomic(root, relativePath, files, options = {}) {
  const projectRoot = fs.realpathSync(path.resolve(root));
  validateRelative(relativePath);
  const normalizedRelativePath = relativePath.replaceAll("\\", "/");
  const maxBytes = options.maxBytes ?? DEFAULT_DIRECTORY_MAX_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
    throw new Error("directory output byte budget is invalid");
  const normalizedFiles = normalizeDirectoryFiles(files, maxBytes);
  const commitFile = normalizeDirectoryFileName(options.commitFile);
  if (!normalizedFiles.some((file) => file.name === commitFile))
    throw new Error("directory output commit file must be present in the bundle");
  const payload = v8.serialize(normalizedFiles.map((file) => [file.name, file.content]));
  const rootStat = fs.statSync(projectRoot);
  if (typeof options.beforeSpawn === "function") options.beforeSpawn();
  const result = spawnSync(
    process.execPath,
    [
      __filename,
      "--child-directory",
      normalizedRelativePath,
      String(options.fileMode ?? 0o666),
      String(options.directoryMode ?? 0o777),
      String(rootStat.dev),
      String(rootStat.ino),
      String(maxBytes),
      commitFile,
    ],
    {
      cwd: projectRoot,
      input: payload,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    }
  );
  const state = readChildState(result, "project directory output write failed");
  try {
    for (const file of normalizedFiles) {
      const outputPath = `${normalizedRelativePath}/${file.name}`;
      const attested = readProjectInput(projectRoot, outputPath, file.content.length);
      if (!attested.bytes.equals(file.content))
        throw new Error(`committed bytes do not match requested output: ${file.name}`);
    }
  } catch (error) {
    const failure = new Error(
      `project directory output committed but path attestation failed: ${error.message}`
    );
    failure.committed = true;
    throw failure;
  }
  assertSupportedDirectorySync(state, "project directory output");
  return { path: path.resolve(projectRoot, normalizedRelativePath), ...state };
}

function writeProjectJsonAtomic(root, relativePath, value, options = {}) {
  return writeProjectFileAtomic(root, relativePath, `${JSON.stringify(value, null, 2)}\n`, options);
}

function writeProjectTextAtomic(root, relativePath, value, options = {}) {
  return writeProjectFileAtomic(root, relativePath, String(value), options);
}

function writeDirectoryFromAnchoredRoot(relativePath, payload, options = {}) {
  validateRelative(relativePath);
  const files = decodeDirectoryPayload(payload, options.maxBytes);
  const commitFile = normalizeDirectoryFileName(options.commitFile);
  if (!files.some((file) => file.name === commitFile))
    throw new Error("directory output commit file must be present in the bundle");
  const projectRoot = fs.realpathSync(".");
  const rootStat = fs.statSync(".");
  if (
    options.expectedRootDev !== undefined &&
    (String(rootStat.dev) !== String(options.expectedRootDev) ||
      String(rootStat.ino) !== String(options.expectedRootIno))
  )
    throw new Error("project root changed before anchored directory output write");
  const parts = relativePath.split(/[\\/]+/);
  const basename = parts.pop();
  for (const part of parts) enterDirectory(part, options.directoryMode ?? 0o777);

  assertPathAbsent(basename, "project directory output already exists");
  let committed = false;
  let destinationStat = null;
  try {
    fs.mkdirSync(basename, { mode: options.directoryMode ?? 0o777 });
    destinationStat = fs.lstatSync(basename);
    if (destinationStat.isSymbolicLink() || !destinationStat.isDirectory())
      throw new Error("project directory destination is not a real directory");

    const writer = spawnSync(
      process.execPath,
      [
        __filename,
        "--child-directory-files",
        String(destinationStat.dev),
        String(destinationStat.ino),
        String(options.fileMode ?? 0o666),
        String(options.maxBytes),
        commitFile,
      ],
      {
        cwd: basename,
        input: payload,
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
      }
    );
    let writerState;
    try {
      writerState = readChildState(writer, "project directory write failed");
    } catch (error) {
      try {
        if (fs.lstatSync(path.join(basename, commitFile)).isFile()) error.committed = true;
      } catch (markerError) {
        if (markerError.code !== "ENOENT") error.committed = true;
      }
      throw error;
    }
    committed = true;

    const observedDestination = fs.lstatSync(basename);
    if (
      observedDestination.isSymbolicLink() ||
      !observedDestination.isDirectory() ||
      observedDestination.dev !== destinationStat.dev ||
      observedDestination.ino !== destinationStat.ino
    )
      throw new Error("project directory destination changed after commit");
    const anchoredRoot = fs.statSync(projectRoot);
    if (anchoredRoot.dev !== rootStat.dev || anchoredRoot.ino !== rootStat.ino)
      throw new Error("project root changed after directory commit");
    const parentDurability = fsyncDirectory();
    const directorySynced =
      writerState.directory_synced === true && parentDurability.synced === true;
    const directorySyncError =
      writerState.directory_sync_error || parentDurability.errorCode || null;
    return {
      committed: true,
      directory_synced: directorySynced,
      ...(directorySyncError ? { directory_sync_error: directorySyncError } : {}),
    };
  } catch (error) {
    if (error.committed === true) committed = true;
    let cleanupError = null;
    if (!committed && destinationStat) {
      try {
        const cleanupTarget = fs.lstatSync(basename);
        if (
          cleanupTarget.isSymbolicLink() ||
          !cleanupTarget.isDirectory() ||
          cleanupTarget.dev !== destinationStat.dev ||
          cleanupTarget.ino !== destinationStat.ino
        ) {
          cleanupError = new Error("project directory destination changed; cleanup skipped");
          cleanupError.code = "ESTALE";
        } else fs.rmSync(basename, { recursive: true, force: true });
      } catch (removeError) {
        if (removeError.code !== "ENOENT") cleanupError = removeError;
      }
    }
    if (committed) {
      const failure = new Error(
        `project directory output committed but verification failed (${error.code || "UNKNOWN"}); do not retry this write`
      );
      failure.committed = true;
      failure.code = error.code || "UNKNOWN";
      throw failure;
    }
    if (cleanupError) throw cleanupError;
    throw error;
  }
}

function writeDirectoryFiles(payload, options = {}) {
  const rootStat = fs.statSync(".");
  if (
    String(rootStat.dev) !== String(options.expectedRootDev) ||
    String(rootStat.ino) !== String(options.expectedRootIno)
  )
    throw new Error("project directory destination changed before anchored write");
  const files = decodeDirectoryPayload(payload, options.maxBytes);
  const commitFile = normalizeDirectoryFileName(options.commitFile);
  const marker = files.find((file) => file.name === commitFile);
  if (!marker) throw new Error("directory output commit file must be present in the bundle");
  try {
    // Make every payload durable before exposing the commit marker.
    for (const file of files) {
      if (file !== marker) writeExclusiveDirectoryFile(file.name, file.content, options.fileMode);
    }
    const beforeCommit = fsyncDirectory();
    if (!beforeCommit.synced && !UNSUPPORTED_DIRECTORY_SYNC_ERRORS.has(beforeCommit.errorCode))
      throw new Error(
        `project directory pre-commit sync failed (${beforeCommit.errorCode || "UNKNOWN"})`
      );
    publishCommitMarker(marker.name, marker.content, options.fileMode);
    const afterCommit = fsyncDirectory();
    if (!afterCommit.synced && !UNSUPPORTED_DIRECTORY_SYNC_ERRORS.has(afterCommit.errorCode)) {
      const failure = new Error(
        `project directory committed but marker sync failed (${afterCommit.errorCode || "UNKNOWN"}); do not retry this write`
      );
      failure.committed = true;
      failure.code = afterCommit.errorCode || "UNKNOWN";
      throw failure;
    }
    return {
      committed: true,
      directory_synced: afterCommit.synced,
      ...(afterCommit.errorCode ? { directory_sync_error: afterCommit.errorCode } : {}),
    };
  } catch (error) {
    try {
      if (fs.lstatSync(commitFile).isFile()) error.committed = true;
    } catch (markerError) {
      if (markerError.code !== "ENOENT") error.committed = true;
    }
    throw error;
  }
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
    const recheckedRoot = fs.statSync(projectRoot);
    if (recheckedRoot.dev !== rootStat.dev || recheckedRoot.ino !== rootStat.ino)
      throw new Error("project root changed during input attestation");
    if (typeof options.beforeCommit === "function") options.beforeCommit();
    if (options.finalAttestation)
      attestProjectInputs(".", [{ ...options.finalAttestation, path: basename }]);
    const commitRoot = fs.statSync(projectRoot);
    if (commitRoot.dev !== rootStat.dev || commitRoot.ino !== rootStat.ino)
      throw new Error("project root changed before atomic commit");
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

function writeExclusiveDirectoryFile(name, content, mode = 0o666) {
  let descriptor;
  try {
    descriptor = fs.openSync(
      name,
      fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        (fs.constants.O_NOFOLLOW || 0),
      mode
    );
    const opened = fs.fstatSync(descriptor);
    fs.writeFileSync(descriptor, content);
    fs.fsyncSync(descriptor);
    const afterWrite = fs.fstatSync(descriptor);
    const finalStat = fs.lstatSync(name);
    if (
      finalStat.isSymbolicLink() ||
      !finalStat.isFile() ||
      finalStat.dev !== opened.dev ||
      finalStat.ino !== opened.ino ||
      afterWrite.dev !== opened.dev ||
      afterWrite.ino !== opened.ino
    )
      throw new Error(`project directory output file changed during write: ${name}`);
    return opened;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function publishCommitMarker(name, content, mode = 0o666) {
  const temporary = `.${name}.tmp-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
  let opened = null;
  let published = false;
  try {
    opened = writeExclusiveDirectoryFile(temporary, content, mode);
    const durableTemporary = fs.lstatSync(temporary);
    if (
      durableTemporary.isSymbolicLink() ||
      !durableTemporary.isFile() ||
      durableTemporary.dev !== opened.dev ||
      durableTemporary.ino !== opened.ino
    )
      throw new Error("project directory commit marker temporary changed before publication");
    fs.linkSync(temporary, name);
    published = true;
    const marker = fs.lstatSync(name);
    if (
      marker.isSymbolicLink() ||
      !marker.isFile() ||
      marker.dev !== opened.dev ||
      marker.ino !== opened.ino
    )
      throw new Error("project directory commit marker changed during publication");
    fs.unlinkSync(temporary);
  } catch (error) {
    if (published) error.committed = true;
    if (opened) {
      try {
        const cleanup = fs.lstatSync(temporary);
        if (
          cleanup.isSymbolicLink() ||
          !cleanup.isFile() ||
          cleanup.dev !== opened.dev ||
          cleanup.ino !== opened.ino
        )
          throw new Error("project directory commit marker temporary changed; cleanup skipped");
        fs.unlinkSync(temporary);
      } catch (cleanupError) {
        if (cleanupError.code !== "ENOENT" && !published) throw cleanupError;
      }
    }
    throw error;
  }
}

function assertPathAbsent(target, message) {
  try {
    fs.lstatSync(target);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  throw new Error(message);
}

function normalizeDirectoryFileName(name) {
  if (typeof name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(name))
    throw new Error("directory output file name is invalid");
  return name;
}

function normalizeDirectoryFiles(files, maxBytes) {
  if (!Array.isArray(files) || files.length === 0 || files.length > MAX_DIRECTORY_FILES)
    throw new Error(`directory output files must contain 1-${MAX_DIRECTORY_FILES} entries`);
  const seen = new Set();
  let totalBytes = 0;
  return files.map((entry) => {
    if (!Array.isArray(entry) || entry.length !== 2)
      throw new Error("directory output files must be [name, content] pairs");
    const name = normalizeDirectoryFileName(entry[0]);
    if (seen.has(name)) throw new Error("directory output file names must be unique");
    seen.add(name);
    if (!Buffer.isBuffer(entry[1]) && typeof entry[1] !== "string")
      throw new Error(`directory output content must be a buffer or string: ${name}`);
    const content = Buffer.isBuffer(entry[1]) ? Buffer.from(entry[1]) : Buffer.from(entry[1]);
    totalBytes += content.length;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > maxBytes)
      throw new Error(`directory output exceeds ${maxBytes}-byte budget`);
    return { name, content };
  });
}

function decodeDirectoryPayload(payload, maxBytes = DEFAULT_DIRECTORY_MAX_BYTES) {
  let files;
  try {
    files = v8.deserialize(payload);
  } catch {
    throw new Error("directory output payload is invalid");
  }
  return normalizeDirectoryFiles(files, maxBytes);
}

function readChildState(result, fallbackMessage) {
  if (result.error) throw result.error;
  let state = null;
  try {
    state = JSON.parse(result.stdout || "null");
  } catch {
    // Preserve the ordinary child failure below.
  }
  if (result.status !== 0) {
    if (state?.committed === true) {
      const failure = new Error(
        state.message || `${fallbackMessage}; the child reported a completed commit`
      );
      failure.committed = true;
      if (state.error_code) failure.code = state.error_code;
      throw failure;
    }
    throw new Error((result.stderr || result.stdout || fallbackMessage).trim());
  }
  if (state?.committed !== true)
    throw new Error(`${fallbackMessage}; child omitted committed state`);
  return state;
}

function assertSupportedDirectorySync(state, label) {
  if (
    state.directory_synced === false &&
    !UNSUPPORTED_DIRECTORY_SYNC_ERRORS.has(state.directory_sync_error)
  ) {
    const failure = new Error(
      `${label} committed but directory sync failed (${state.directory_sync_error || "UNKNOWN"}); do not retry this write`
    );
    failure.committed = true;
    failure.directorySyncError = state.directory_sync_error || "UNKNOWN";
    throw failure;
  }
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

function childDirectoryMain(argv) {
  try {
    const [
      ,
      relativePath,
      fileMode,
      directoryMode,
      expectedRootDev,
      expectedRootIno,
      maxBytes,
      commitFile,
    ] = argv;
    const payload = fs.readFileSync(0);
    const state = writeDirectoryFromAnchoredRoot(relativePath, payload, {
      fileMode: Number(fileMode),
      directoryMode: Number(directoryMode),
      expectedRootDev,
      expectedRootIno,
      maxBytes: Number(maxBytes),
      commitFile,
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

function childDirectoryFilesMain(argv) {
  try {
    const [, expectedRootDev, expectedRootIno, fileMode, maxBytes, commitFile] = argv;
    const payload = fs.readFileSync(0);
    const state = writeDirectoryFiles(payload, {
      expectedRootDev,
      expectedRootIno,
      fileMode: Number(fileMode),
      maxBytes: Number(maxBytes),
      commitFile,
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

if (require.main === module) {
  const argv = process.argv.slice(2);
  if (argv[0] === "--child-directory") process.exitCode = childDirectoryMain(argv);
  else if (argv[0] === "--child-directory-files") process.exitCode = childDirectoryFilesMain(argv);
  else process.exitCode = childMain(argv);
}

module.exports = {
  writeProjectDirectoryAtomic,
  writeProjectFileAtomic,
  writeProjectJsonAtomic,
  writeProjectTextAtomic,
};
