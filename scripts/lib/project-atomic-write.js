"use strict";

const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const v8 = require("node:v8");
const { acquireOwnedLock } = require("./owned-lock");
const {
  managedDirectoryPointerPublication,
  readProjectInput,
  resolveManagedDirectoryPointerTarget,
} = require("./safe-project-output");

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
const DIRECTORY_OWNER_FILE = ".pm-directory-owner.json";
const DIRECTORY_POINTER_FILE = ".pm-directory-pointer.json";
const DIRECTORY_BUNDLE_PREFIX = ".pm-dir-bundle-";
const DIRECTORY_WRITE_CHUNK_BYTES = 4 * 1024 * 1024;
const FILE_WRITE_LOCK_ATTEMPTS = 601;
const FILE_WRITE_LOCK_WAIT_MS = 50;

function projectFileLockPath(projectRoot, rootStat, relativePath) {
  let ownerNamespace = "unknown";
  try {
    ownerNamespace =
      typeof process.getuid === "function"
        ? String(process.getuid())
        : crypto.createHash("sha256").update(os.userInfo().username).digest("hex").slice(0, 16);
  } catch {
    // The digest below still isolates projects when the host cannot expose a user identity.
  }
  const target = crypto
    .createHash("sha256")
    .update(`${projectRoot}\0${String(rootStat.dev)}\0${String(rootStat.ino)}\0${relativePath}`)
    .digest("hex");
  return path.join(os.tmpdir(), `.pm-project-write-${ownerNamespace}-${target}.lock`);
}

function acquireProjectFileLock(projectRoot, rootStat, relativePath) {
  return acquireOwnedLock(projectFileLockPath(projectRoot, rootStat, relativePath), {
    attempts: FILE_WRITE_LOCK_ATTEMPTS,
    waitMs: FILE_WRITE_LOCK_WAIT_MS,
    invalidGraceMs: 1_000,
    directoryMode: 0o700,
    fileMode: 0o600,
    timeoutMessage: `timed out waiting for atomic project write lock: ${relativePath}`,
  });
}

function acquireProjectWriteLock(root, relativeNamespace, options = {}) {
  const projectRoot = fs.realpathSync(path.resolve(root));
  validateRelative(relativeNamespace);
  const normalizedNamespace = relativeNamespace.replaceAll("\\", "/");
  const rootStat = fs.statSync(projectRoot, { bigint: true });
  const hasExpectedRootDev = options.expectedRootDev !== undefined;
  const hasExpectedRootIno = options.expectedRootIno !== undefined;
  if (hasExpectedRootDev !== hasExpectedRootIno)
    throw new Error("expected project root identity requires both dev and ino");
  if (
    hasExpectedRootDev &&
    (String(rootStat.dev) !== String(options.expectedRootDev) ||
      String(rootStat.ino) !== String(options.expectedRootIno))
  ) {
    throw new Error("project root identity changed before lock acquisition");
  }
  return acquireOwnedLock(projectFileLockPath(projectRoot, rootStat, normalizedNamespace), {
    attempts: options.attempts ?? FILE_WRITE_LOCK_ATTEMPTS,
    waitMs: options.waitMs ?? FILE_WRITE_LOCK_WAIT_MS,
    invalidGraceMs: options.invalidGraceMs ?? 1_000,
    directoryMode: options.directoryMode ?? 0o700,
    fileMode: options.fileMode ?? 0o600,
    timeoutMessage:
      options.timeoutMessage || `timed out waiting for project write lock: ${normalizedNamespace}`,
  });
}

function writeProjectFileAtomic(root, relativePath, content, options = {}) {
  const projectRoot = fs.realpathSync(path.resolve(root));
  validateRelative(relativePath);
  const normalizedRelativePath = relativePath.replaceAll("\\", "/");
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(String(content));
  const maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
  if (options.acceptIdentical !== undefined && typeof options.acceptIdentical !== "boolean")
    throw new Error("acceptIdentical must be a boolean");
  if (options.acceptIdentical === true && options.replace !== false)
    throw new Error("acceptIdentical requires replace: false");
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || bytes.length > maxBytes)
    throw new Error(`output exceeds ${maxBytes}-byte budget`);
  const rootStat = fs.statSync(projectRoot, { bigint: true });
  const hasExpectedRootDev = options.expectedRootDev !== undefined;
  const hasExpectedRootIno = options.expectedRootIno !== undefined;
  if (hasExpectedRootDev !== hasExpectedRootIno)
    throw new Error("expected project root identity requires both dev and ino");
  if (
    hasExpectedRootDev &&
    (String(rootStat.dev) !== String(options.expectedRootDev) ||
      String(rootStat.ino) !== String(options.expectedRootIno))
  ) {
    throw new Error("project root identity changed before atomic write");
  }
  const attestations = normalizeAttestations(options.attestations || []);
  const finalAttestation = options.finalAttestation
    ? normalizeAttestations([options.finalAttestation])[0]
    : null;
  if (finalAttestation && finalAttestation.path !== normalizedRelativePath)
    throw new Error("atomic write final attestation must target the output path");
  const releaseLock = acquireProjectFileLock(projectRoot, rootStat, normalizedRelativePath);
  try {
    if (typeof options.beforeSpawn === "function") options.beforeSpawn();
    const result = spawnSync(
      process.execPath,
      [
        __filename,
        "--child",
        normalizedRelativePath,
        String(options.fileMode ?? 0o666),
        String(options.directoryMode ?? 0o777),
        options.replace === false ? "exclusive" : "replace",
        options.acceptIdentical === true ? "accept-identical" : "strict",
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
    let childState = null;
    try {
      childState = JSON.parse(result.stdout || "null");
    } catch {
      // Unstructured child failures are reconciled against the public path below.
    }
    if (result.status !== 0 || result.error || childState?.committed !== true) {
      if (childState?.committed === true) {
        const failure = new Error(
          childState.message ||
            "project output committed but child cleanup failed; do not retry this write"
        );
        failure.committed = true;
        if (childState.error_code) failure.code = childState.error_code;
        throw failure;
      }
      if (childState?.committed === false) {
        const failure = new Error(
          childState.message || (result.stderr || "project output write failed").trim()
        );
        failure.committed = false;
        if (childState.error_code) failure.code = childState.error_code;
        throw failure;
      }
      const reconciliation = reconcileProjectFile(
        projectRoot,
        normalizedRelativePath,
        bytes,
        maxBytes
      );
      if (reconciliation.state === "committed") {
        const failure = new Error(
          "project output committed before its writer reported state; do not retry this write"
        );
        failure.committed = true;
        failure.directorySynced = reconciliation.directory_synced;
        if (reconciliation.directory_sync_error)
          failure.directorySyncError = reconciliation.directory_sync_error;
        throw failure;
      }
      if (reconciliation.state === "unknown") {
        const failure = new Error(
          `project output commit state is unknown (${reconciliation.message}); do not retry this write`
        );
        failure.committed = null;
        failure.commitState = "unknown";
        failure.retryable = false;
        throw failure;
      }
      if (result.error) throw result.error;
      throw new Error((result.stderr || result.stdout || "project output write failed").trim());
    }
    const state = childState;
    try {
      const attested = readProjectInput(projectRoot, normalizedRelativePath, maxBytes);
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
    return { path: path.resolve(projectRoot, normalizedRelativePath), ...state };
  } finally {
    releaseLock();
  }
}

// The publishing child serializes writers for the canonical path, builds and
// verifies a fully durable nonce-named real directory, then exposes the whole
// bundle at once through an atomically-created managed relative symlink.
function writeProjectDirectoryAtomic(root, relativePath, files, options = {}) {
  const projectRoot = fs.realpathSync(path.resolve(root));
  validateRelative(relativePath);
  const normalizedRelativePath = relativePath.replaceAll("\\", "/");
  const maxBytes = options.maxBytes ?? DEFAULT_DIRECTORY_MAX_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > DEFAULT_DIRECTORY_MAX_BYTES)
    throw new Error("directory output byte budget is invalid");
  const normalizedFiles = normalizeDirectoryFiles(files, maxBytes);
  const commitFile = normalizeDirectoryFileName(options.commitFile);
  if (!normalizedFiles.some((file) => file.name === commitFile))
    throw new Error("directory output commit file must be present in the bundle");
  const payload = v8.serialize(normalizedFiles.map((file) => [file.name, file.content]));
  const rootStat = fs.statSync(projectRoot, { bigint: true });
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
  let state;
  try {
    state = readChildState(result, "project directory output write failed");
  } catch (error) {
    if (error.committed === true) throw error;
    if (error.knownNonCommit === true) throw error;
    const reconciliation = reconcileDirectoryBundle(
      projectRoot,
      normalizedRelativePath,
      normalizedFiles,
      commitFile
    );
    if (reconciliation.state === "committed") {
      const failure = new Error(
        "project directory output committed before its writer reported state; do not retry this write"
      );
      failure.committed = true;
      throw failure;
    }
    if (reconciliation.state === "unknown") {
      const failure = new Error(
        `project directory output commit state is unknown (${reconciliation.message}); do not retry this write`
      );
      failure.committed = null;
      failure.commitState = "unknown";
      failure.retryable = false;
      throw failure;
    }
    throw error;
  }
  let attested;
  try {
    attested = reconcileDirectoryBundle(
      projectRoot,
      normalizedRelativePath,
      normalizedFiles,
      commitFile
    );
    if (attested.state !== "committed")
      throw new Error(attested.message || "committed bundle could not be verified");
  } catch (error) {
    const failure = new Error(
      `project directory output committed but path attestation failed: ${error.message}`
    );
    failure.committed = true;
    throw failure;
  }
  assertSupportedDirectorySync(state, "project directory output");
  assertSupportedDirectorySync(attested, "project directory output reconciliation");
  const directorySyncError = state.directory_sync_error || attested.directory_sync_error || null;
  return {
    path: path.resolve(projectRoot, normalizedRelativePath),
    ...state,
    directory_synced: state.directory_synced === true && attested.directory_synced === true,
    ...(directorySyncError ? { directory_sync_error: directorySyncError } : {}),
  };
}

function reconcileDirectoryBundle(projectRoot, relativePath, files, commitFile) {
  const initial = inspectDirectoryBundle(projectRoot, relativePath, files, commitFile);
  if (initial.state !== "committed") return initial;
  let directorySyncError = null;
  try {
    // inspectDirectoryBundle accepts only an authenticated managed pointer, so
    // the publication durability barrier belongs to its canonical parent.
    fsyncContainedDirectory(projectRoot, path.dirname(relativePath));
  } catch (error) {
    if (!UNSUPPORTED_DIRECTORY_SYNC_ERRORS.has(error.code))
      return {
        state: "unknown",
        message: `the published bundle directory could not be synced: ${error.message}`,
      };
    directorySyncError = error.code;
  }
  const durable = inspectDirectoryBundle(projectRoot, relativePath, files, commitFile);
  if (durable.state !== "committed") {
    return {
      state: "unknown",
      message: `the published bundle changed during durability reconciliation: ${durable.message || durable.state}`,
    };
  }
  return {
    ...durable,
    directory_synced: directorySyncError === null,
    ...(directorySyncError ? { directory_sync_error: directorySyncError } : {}),
  };
}

function inspectDirectoryBundle(projectRoot, relativePath, files, commitFile) {
  const marker = files.find((file) => file.name === commitFile);
  const expectedInventory = [...files]
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
    .map((file) => ({
      name: file.name,
      size: file.content.length,
      sha256: `sha256:${crypto.createHash("sha256").update(file.content).digest("hex")}`,
    }));
  try {
    const observedMarker = readProjectInput(
      projectRoot,
      `${relativePath}/${commitFile}`,
      marker.content.length,
      { allowManagedDirectoryPointers: true }
    );
    if (!observedMarker.bytes.equals(marker.content))
      return {
        state: "unknown",
        message: "the published marker bytes differ from the requested commit marker",
      };
    const managed = observedMarker.managedDirectory;
    if (!managed)
      return {
        state: "unknown",
        message: "the published directory is not an authenticated managed bundle",
      };
    if (
      managed.commitFile !== commitFile ||
      managed.files.length !== expectedInventory.length ||
      managed.files.some((file, index) => {
        const expected = expectedInventory[index];
        return (
          file.name !== expected.name ||
          file.size !== expected.size ||
          file.sha256 !== expected.sha256
        );
      })
    )
      return {
        state: "unknown",
        message: "the published managed bundle inventory differs from the requested output",
      };
  } catch (error) {
    if (error.code === "ENOENT") return { state: "not-committed" };
    return { state: "unknown", message: error.message };
  }

  // readProjectInput authenticates every inventoried payload against the
  // manifest before returning the marker.  Matching that complete inventory
  // to the requested hashes therefore attests the whole bundle in one pass.
  return { state: "committed" };
}

function reconcileProjectFile(projectRoot, relativePath, expectedBytes, maxBytes) {
  const inspect = () => {
    try {
      const observed = readProjectInput(projectRoot, relativePath, maxBytes);
      if (!observed.bytes.equals(expectedBytes)) {
        return { state: "unknown", message: "the public bytes differ from the requested output" };
      }
      return { state: "committed" };
    } catch (error) {
      if (error.code === "ENOENT") return { state: "not-committed" };
      return { state: "unknown", message: error.message };
    }
  };
  const initial = inspect();
  if (initial.state !== "committed") return initial;
  let directorySyncError = null;
  try {
    fsyncContainedDirectory(projectRoot, path.dirname(relativePath));
  } catch (error) {
    if (!UNSUPPORTED_DIRECTORY_SYNC_ERRORS.has(error.code))
      return {
        state: "unknown",
        message: `the published output directory could not be synced: ${error.message}`,
      };
    directorySyncError = error.code;
  }
  const durable = inspect();
  if (durable.state !== "committed") {
    return {
      state: "unknown",
      message: `the public output changed during durability reconciliation: ${durable.message || durable.state}`,
    };
  }
  return {
    ...durable,
    directory_synced: directorySyncError === null,
    ...(directorySyncError ? { directory_sync_error: directorySyncError } : {}),
  };
}

function fsyncContainedDirectory(projectRoot, relativeDirectory) {
  const requestedRoot = path.resolve(projectRoot);
  const root = fs.realpathSync(requestedRoot);
  if (root !== requestedRoot) throw new Error("directory sync root changed during reconciliation");
  const normalized = relativeDirectory === "." ? "" : relativeDirectory;
  if (path.isAbsolute(normalized) || normalized.split(/[\\/]+/).some((part) => part === ".."))
    throw new Error("directory sync path escapes project root");
  const absolute = path.resolve(root, normalized);
  const relation = path.relative(root, absolute);
  if (relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
    throw new Error("directory sync path escapes project root");
  }
  const directories = [root];
  let current = root;
  for (const part of relation ? relation.split(path.sep) : []) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error("directory sync path must contain only real directories");
    }
    directories.push(current);
  }
  for (const directory of directories) fsyncExactDirectory(directory);
}

function fsyncExactDirectory(absolute) {
  let descriptor;
  try {
    descriptor = fs.openSync(absolute, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const opened = fs.fstatSync(descriptor, { bigint: true });
    const published = fs.lstatSync(absolute, { bigint: true });
    if (
      !opened.isDirectory() ||
      published.isSymbolicLink() ||
      !published.isDirectory() ||
      !sameInode(opened, published)
    )
      throw staleDirectoryError("directory sync path changed during inspection");
    fs.fsyncSync(descriptor);
    const after = fs.fstatSync(descriptor, { bigint: true });
    const finalPath = fs.lstatSync(absolute, { bigint: true });
    if (!sameInode(opened, after) || !sameInode(opened, finalPath)) {
      throw staleDirectoryError("directory sync path changed during durability barrier");
    }
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function writeProjectJsonAtomic(root, relativePath, value, options = {}) {
  return writeProjectFileAtomic(root, relativePath, `${JSON.stringify(value, null, 2)}\n`, options);
}

function writeProjectTextAtomic(root, relativePath, value, options = {}) {
  return writeProjectFileAtomic(root, relativePath, String(value), options);
}

function writeDirectoryFromAnchoredRoot(relativePath, payload, options = {}) {
  return writeManagedDirectoryFromAnchoredRoot(relativePath, payload, options);
}

// A real directory cannot be published exclusively with Node's rename API:
// POSIX rename replaces an existing empty directory.  Publish a fully durable,
// nonce-named real bundle through an atomically-created relative directory
// symlink on POSIX, a sibling-bound junction on local Windows volumes, or a
// relative directory symlink for Windows UNC paths where junctions are invalid.
// The canonical entry is therefore either absent, foreign, or a complete
// managed bundle; there is no public mkdir/lease crash window.
function writeManagedDirectoryFromAnchoredRoot(relativePath, payload, options = {}) {
  validateRelative(relativePath);
  const projectRoot = fs.realpathSync(".");
  const rootStat = fs.statSync(".", { bigint: true });
  const releaseLock = acquireProjectFileLock(
    projectRoot,
    rootStat,
    relativePath.replaceAll("\\", "/")
  );
  let state = null;
  let failure = null;
  try {
    state = writeLockedManagedDirectoryFromAnchoredRoot(relativePath, payload, options);
  } catch (error) {
    failure = error;
  }
  try {
    releaseLock();
  } catch (error) {
    if (state?.committed === true || failure?.committed === true) error.committed = true;
    throw error;
  }
  if (failure) throw failure;
  return state;
}

function writeLockedManagedDirectoryFromAnchoredRoot(relativePath, payload, options = {}) {
  validateRelative(relativePath);
  const files = decodeDirectoryPayload(payload, options.maxBytes);
  const commitFile = normalizeDirectoryFileName(options.commitFile);
  if (!files.some((file) => file.name === commitFile))
    throw new Error("directory output commit file must be present in the bundle");
  const projectRoot = fs.realpathSync(".");
  const rootStat = fs.statSync(".", { bigint: true });
  if (
    options.expectedRootDev !== undefined &&
    (String(rootStat.dev) !== String(options.expectedRootDev) ||
      String(rootStat.ino) !== String(options.expectedRootIno))
  )
    throw new Error("project root changed before anchored directory output write");

  const parts = relativePath.split(/[\\/]+/);
  const basename = parts.pop();
  let ancestorsSynced = true;
  let ancestorSyncError = null;
  for (const part of parts) {
    const durability = enterDirectory(part, options.directoryMode ?? 0o777);
    ancestorsSynced &&= durability.synced;
    ancestorSyncError ||= durability.errorCode || null;
  }

  const parentStat = fs.statSync(".", { bigint: true });
  assertAnchoredDirectoryParent(projectRoot, relativePath, rootStat, parentStat);
  let bundleName = null;
  let bundleStat = null;
  let enteredBundle = false;
  let committed = false;
  let bundleDurability = { synced: false, errorCode: "UNKNOWN" };
  let prepublishDurability = { synced: false, errorCode: "UNKNOWN" };
  let publicationDurability = { synced: false, errorCode: "UNKNOWN" };
  try {
    let existing = null;
    try {
      existing = fs.lstatSync(basename, { bigint: true });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (existing) {
      if (existing.isSymbolicLink()) {
        assertAnchoredDirectoryParent(
          projectRoot,
          relativePath,
          rootStat,
          parentStat,
          "project root or destination parent changed before pointer reconciliation"
        );
        const reconciliation = inspectDirectoryBundle(projectRoot, relativePath, files, commitFile);
        if (reconciliation.state === "committed") {
          const reconciledPointer = fs.lstatSync(basename, { bigint: true });
          assertAnchoredDirectoryParent(
            projectRoot,
            relativePath,
            rootStat,
            parentStat,
            "project root or destination parent changed during pointer reconciliation"
          );
          if (!reconciledPointer.isSymbolicLink() || !sameOwnerFile(existing, reconciledPointer))
            throw staleDirectoryError("project root or pointer changed during reconciliation");
          publicationDurability = fsyncDirectory();
          if (
            !publicationDurability.synced &&
            !UNSUPPORTED_DIRECTORY_SYNC_ERRORS.has(publicationDurability.errorCode)
          )
            throw new Error(
              `project directory pointer reconciliation sync failed (${publicationDurability.errorCode || "UNKNOWN"})`
            );
          assertAnchoredDirectoryParent(
            projectRoot,
            relativePath,
            rootStat,
            parentStat,
            "project root or destination parent changed during pointer reconciliation sync"
          );
          return {
            committed: true,
            directory_synced: ancestorsSynced && publicationDurability.synced,
            ...(ancestorSyncError || publicationDurability.errorCode
              ? {
                  directory_sync_error: ancestorSyncError || publicationDurability.errorCode,
                }
              : {}),
          };
        }
      }
      throw new Error("project directory output already exists");
    }

    const nonce = crypto.randomBytes(24).toString("hex");
    bundleName = managedDirectoryBundleName(basename, nonce);
    fs.mkdirSync(bundleName, { mode: options.directoryMode ?? 0o777 });
    bundleStat = fs.lstatSync(bundleName, { bigint: true });
    if (bundleStat.isSymbolicLink() || !bundleStat.isDirectory())
      throw new Error("project directory bundle is not a real directory");

    process.chdir(bundleName);
    enteredBundle = true;
    const entered = fs.statSync(".", { bigint: true });
    if (!sameInode(entered, bundleStat))
      throw staleDirectoryError("project directory bundle changed during entry");
    assertPublishedDirectoryFromInside(bundleName, parentStat, bundleStat);

    for (const file of files)
      writeExclusiveDirectoryFile(file.name, file.content, options.fileMode);
    const manifest = managedDirectoryManifest(
      basename,
      bundleName,
      nonce,
      bundleStat,
      commitFile,
      files
    );
    writeExclusiveDirectoryFile(
      DIRECTORY_POINTER_FILE,
      Buffer.from(`${JSON.stringify(manifest)}\n`),
      0o600
    );
    bundleDurability = fsyncDirectory();
    if (
      !bundleDurability.synced &&
      !UNSUPPORTED_DIRECTORY_SYNC_ERRORS.has(bundleDurability.errorCode)
    )
      throw new Error(
        `project directory bundle sync failed (${bundleDurability.errorCode || "UNKNOWN"})`
      );
    assertManagedDirectoryBundle(".", basename, bundleName, bundleStat, manifest, files);
    assertPublishedDirectoryFromInside(bundleName, parentStat, bundleStat);

    process.chdir("..");
    enteredBundle = false;
    const observedParent = fs.statSync(".", { bigint: true });
    if (!sameInode(observedParent, parentStat))
      throw staleDirectoryError("project directory bundle parent changed");
    assertAnchoredDirectoryParent(projectRoot, relativePath, rootStat, parentStat);
    const publishedBundle = fs.lstatSync(bundleName, { bigint: true });
    if (
      publishedBundle.isSymbolicLink() ||
      !publishedBundle.isDirectory() ||
      !sameInode(publishedBundle, bundleStat)
    )
      throw staleDirectoryError("project directory bundle changed before publication");

    // Make the backing directory entry durable before exposing its pointer.
    prepublishDurability = fsyncDirectory();
    if (
      !prepublishDurability.synced &&
      !UNSUPPORTED_DIRECTORY_SYNC_ERRORS.has(prepublishDurability.errorCode)
    )
      throw new Error(
        `project directory bundle publication sync failed (${prepublishDurability.errorCode || "UNKNOWN"})`
      );
    assertAnchoredDirectoryParent(
      projectRoot,
      relativePath,
      rootStat,
      parentStat,
      "project root or destination parent changed before pointer publication"
    );

    const publication = managedDirectoryPointerPublication(bundleName, fs.realpathSync("."));
    try {
      if (publication.type) fs.symlinkSync(publication.target, basename, publication.type);
      else fs.symlinkSync(publication.target, basename);
    } catch (error) {
      if (process.platform === "win32" && publication.type === "dir") {
        const failure = new Error(
          `Windows UNC managed directory publication requires directory symlink support: ${error.message}`
        );
        failure.code = error.code;
        throw failure;
      }
      throw error;
    }
    committed = true;

    const pointer = fs.lstatSync(basename, { bigint: true });
    const pointerTarget = fs.readlinkSync(basename);
    let resolvedPointer;
    try {
      resolvedPointer = resolveManagedDirectoryPointerTarget(
        path.resolve(basename),
        basename,
        pointerTarget
      );
    } catch {
      throw staleDirectoryError("project directory managed pointer changed during publication");
    }
    if (!pointer.isSymbolicLink() || resolvedPointer.targetBasename !== bundleName)
      throw staleDirectoryError("project directory managed pointer changed during publication");
    const finalBundle = fs.lstatSync(bundleName, { bigint: true });
    if (
      finalBundle.isSymbolicLink() ||
      !finalBundle.isDirectory() ||
      !sameInode(finalBundle, bundleStat)
    )
      throw staleDirectoryError("project directory bundle changed during publication");

    publicationDurability = fsyncDirectory();
    if (
      !publicationDurability.synced &&
      !UNSUPPORTED_DIRECTORY_SYNC_ERRORS.has(publicationDurability.errorCode)
    ) {
      const failure = new Error(
        `project directory committed but pointer sync failed (${publicationDurability.errorCode || "UNKNOWN"}); do not retry this write`
      );
      failure.committed = true;
      failure.code = publicationDurability.errorCode || "UNKNOWN";
      throw failure;
    }
    assertAnchoredDirectoryParent(
      projectRoot,
      relativePath,
      rootStat,
      parentStat,
      "project root or destination parent changed after pointer publication sync"
    );
    const directorySynced =
      ancestorsSynced &&
      bundleDurability.synced === true &&
      prepublishDurability.synced === true &&
      publicationDurability.synced === true;
    const directorySyncError =
      ancestorSyncError ||
      bundleDurability.errorCode ||
      prepublishDurability.errorCode ||
      publicationDurability.errorCode ||
      null;
    return {
      committed: true,
      directory_synced: directorySynced,
      ...(directorySyncError ? { directory_sync_error: directorySyncError } : {}),
    };
  } catch (error) {
    let failureCause = error;
    if (enteredBundle)
      try {
        process.chdir("..");
        enteredBundle = false;
      } catch (exitError) {
        if (committed) failureCause = exitError;
      }
    if (committed || failureCause.committed === true) {
      const failure = new Error(
        `project directory output committed but verification failed (${failureCause.code || "UNKNOWN"}); do not retry this write`
      );
      failure.committed = true;
      failure.code = failureCause.code || "UNKNOWN";
      throw failure;
    }
    throw failureCause;
  }
}

function managedDirectoryBundleName(basename, nonce) {
  return `${DIRECTORY_BUNDLE_PREFIX}${crypto
    .createHash("sha256")
    .update(basename)
    .digest("hex")
    .slice(0, 32)}-${nonce}`;
}

function managedDirectoryManifest(basename, bundleName, nonce, bundleStat, commitFile, files) {
  return {
    schema_version: 1,
    kind: "pm-managed-directory-bundle",
    canonical_basename_sha256: crypto.createHash("sha256").update(basename).digest("hex"),
    target_basename: bundleName,
    nonce,
    bundle_dev: String(bundleStat.dev),
    bundle_ino: String(bundleStat.ino),
    commit_file: commitFile,
    files: [...files]
      .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
      .map((file) => ({
        name: file.name,
        size: file.content.length,
        sha256: `sha256:${crypto.createHash("sha256").update(file.content).digest("hex")}`,
      })),
  };
}

function assertManagedDirectoryBundle(
  directory,
  basename,
  bundleName,
  bundleStat,
  expectedManifest,
  files
) {
  const observedDirectory = fs.statSync(directory, { bigint: true });
  if (!sameInode(observedDirectory, bundleStat))
    throw staleDirectoryError("project directory bundle changed during verification");
  const entries = fs.readdirSync(directory).sort();
  const expectedEntries = [DIRECTORY_POINTER_FILE, ...files.map((file) => file.name)].sort();
  if (
    entries.length !== expectedEntries.length ||
    entries.some((entry, index) => entry !== expectedEntries[index])
  )
    throw staleDirectoryError("project directory bundle contents changed during verification");
  for (const file of files)
    readExactManagedDirectoryFile(path.join(directory, file.name), file.content);
  const expectedManifestBytes = Buffer.from(`${JSON.stringify(expectedManifest)}\n`);
  const manifestBytes = readExactManagedDirectoryFile(
    path.join(directory, DIRECTORY_POINTER_FILE),
    expectedManifestBytes
  );
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    throw staleDirectoryError("project directory bundle manifest is invalid JSON");
  }
  if (JSON.stringify(manifest) !== JSON.stringify(expectedManifest))
    throw staleDirectoryError("project directory bundle manifest changed before publication");
  if (
    expectedManifest.target_basename !== bundleName ||
    expectedManifest.canonical_basename_sha256 !==
      crypto.createHash("sha256").update(basename).digest("hex")
  )
    throw staleDirectoryError("project directory bundle manifest is not bound to its pointer");
}

function readExactManagedDirectoryFile(file, expected) {
  let descriptor;
  try {
    descriptor = fs.openSync(
      file,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0)
    );
    const before = fs.fstatSync(descriptor, { bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size !== BigInt(expected.length))
      throw staleDirectoryError(
        "project directory bundle file metadata changed before publication"
      );
    const bytes = Buffer.alloc(expected.length);
    let offset = 0;
    while (offset < bytes.length) {
      const read = fs.readSync(descriptor, bytes, offset, bytes.length - offset, null);
      if (read === 0)
        throw staleDirectoryError("project directory bundle file was truncated before publication");
      offset += read;
    }
    if (fs.readSync(descriptor, Buffer.alloc(1), 0, 1, null) !== 0)
      throw staleDirectoryError("project directory bundle file grew before publication");
    const after = fs.fstatSync(descriptor, { bigint: true });
    const linked = fs.lstatSync(file, { bigint: true });
    if (
      !after.isFile() ||
      after.nlink !== 1n ||
      linked.isSymbolicLink() ||
      !linked.isFile() ||
      linked.nlink !== 1n ||
      !sameOwnerFile(before, after) ||
      !sameOwnerFile(after, linked) ||
      !bytes.equals(expected)
    )
      throw staleDirectoryError("project directory bundle file changed before publication");
    return bytes;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function staleDirectoryError(message = "project directory destination changed; cleanup skipped") {
  const error = new Error(message);
  error.code = "ESTALE";
  return error;
}

function sameInode(left, right) {
  return String(left.dev) === String(right.dev) && String(left.ino) === String(right.ino);
}

function sameOwnerFile(left, right) {
  return (
    sameInode(left, right) &&
    String(left.size) === String(right.size) &&
    String(left.mtimeNs) === String(right.mtimeNs) &&
    String(left.ctimeNs) === String(right.ctimeNs)
  );
}

function assertPublishedDirectoryFromInside(basename, expectedParent, expectedDestination) {
  const observedParent = fs.statSync("..", { bigint: true });
  if (!sameInode(observedParent, expectedParent))
    throw staleDirectoryError("project directory destination parent changed");
  const published = fs.lstatSync(path.join("..", basename), { bigint: true });
  if (
    published.isSymbolicLink() ||
    !published.isDirectory() ||
    !sameInode(published, expectedDestination)
  )
    throw staleDirectoryError("project directory destination changed at its published path");
}

function assertAnchoredDirectoryParent(
  projectRoot,
  relativePath,
  expectedRoot,
  expectedParent,
  message = "project root or destination parent changed during directory publication"
) {
  const rootPath = path.resolve(projectRoot);
  const parentParts = relativePath.split(/[\\/]+/).slice(0, -1);
  const observed = [];
  let current = rootPath;
  for (const [index, part] of ["", ...parentParts].entries()) {
    if (index > 0) current = path.join(current, part);
    const stat = fs.lstatSync(current, { bigint: true });
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw staleDirectoryError(message);
    observed.push({ path: current, stat });
  }
  if (
    !sameInode(observed[0].stat, expectedRoot) ||
    !sameInode(observed.at(-1).stat, expectedParent) ||
    !sameInode(fs.statSync(".", { bigint: true }), expectedParent)
  )
    throw staleDirectoryError(message);
  for (const component of observed) {
    const rechecked = fs.lstatSync(component.path, { bigint: true });
    if (
      rechecked.isSymbolicLink() ||
      !rechecked.isDirectory() ||
      !sameInode(component.stat, rechecked)
    )
      throw staleDirectoryError(message);
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
  let ancestorsSynced = true;
  let ancestorSyncError = null;
  for (const part of parts) {
    const durability = enterDirectory(part, options.directoryMode ?? 0o777);
    ancestorsSynced &&= durability.synced;
    ancestorSyncError ||= durability.errorCode || null;
  }
  const parentStat = fs.statSync(".", { bigint: true });

  const temporary = `.${basename}.tmp-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
  let descriptor;
  let opened = null;
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
    opened = fs.fstatSync(descriptor);
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
    let reused = false;
    if (options.replace === false) {
      try {
        fs.linkSync(temporary, basename);
      } catch (error) {
        if (error.code !== "EEXIST" || options.acceptIdentical !== true) throw error;
        assertAnchoredDirectoryParent(
          projectRoot,
          relativePath,
          rootStat,
          parentStat,
          "project root or destination parent changed during identical output reconciliation"
        );
        readExactAtomicFile(basename, content, options.fileMode ?? 0o666);
        assertAnchoredDirectoryParent(
          projectRoot,
          relativePath,
          rootStat,
          parentStat,
          "project root or destination parent changed during identical output reconciliation"
        );
        reused = true;
      }
    } else fs.renameSync(temporary, basename);
    if (reused) {
      fs.unlinkSync(temporary);
      fs.closeSync(descriptor);
      descriptor = undefined;
      const durability = fsyncDirectory();
      return {
        committed: true,
        reused: true,
        directory_synced: ancestorsSynced && durability.synced,
        ...(ancestorSyncError || durability.errorCode
          ? { directory_sync_error: ancestorSyncError || durability.errorCode }
          : {}),
      };
    }
    committed = true;
    const finalStat = fs.lstatSync(basename);
    if (
      finalStat.isSymbolicLink() ||
      !finalStat.isFile() ||
      finalStat.dev !== opened.dev ||
      finalStat.ino !== opened.ino
    )
      throw new Error("project output changed during atomic commit");
    if (options.replace === false) fs.unlinkSync(temporary);
    fs.closeSync(descriptor);
    descriptor = undefined;
    const durability = fsyncDirectory();
    return {
      committed: true,
      directory_synced: ancestorsSynced && durability.synced,
      ...(ancestorSyncError || durability.errorCode
        ? { directory_sync_error: ancestorSyncError || durability.errorCode }
        : {}),
    };
  } catch (error) {
    let cleanupError = null;
    if (descriptor !== undefined)
      try {
        fs.closeSync(descriptor);
      } catch (closeError) {
        cleanupError = closeError;
      }
    if (!committed && opened)
      try {
        const cleanup = fs.lstatSync(temporary);
        if (
          cleanup.isSymbolicLink() ||
          !cleanup.isFile() ||
          (opened && !sameInode(cleanup, opened))
        )
          throw staleDirectoryError("project output temporary changed; cleanup skipped");
        fs.unlinkSync(temporary);
      } catch (removeError) {
        if (removeError.code !== "ENOENT") cleanupError ||= removeError;
      }
    if (committed) {
      const cause = cleanupError || error;
      const failure = new Error(
        `project output committed but verification failed (${cause.code || "UNKNOWN"}); do not retry this write`
      );
      failure.committed = true;
      failure.code = cause.code || "UNKNOWN";
      throw failure;
    }
    if (cleanupError) throw cleanupError;
    throw error;
  }
}

function readExactAtomicFile(file, expected, allowedMode) {
  let descriptor;
  try {
    descriptor = fs.openSync(
      file,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0)
    );
    const before = fs.fstatSync(descriptor, { bigint: true });
    if (
      !before.isFile() ||
      before.nlink !== 1n ||
      before.size !== BigInt(expected.length) ||
      (Number(before.mode) & 0o777 & ~(allowedMode & 0o777)) !== 0
    ) {
      throw staleDirectoryError("existing project output is not an identical private file");
    }
    const bytes = Buffer.alloc(expected.length);
    let offset = 0;
    while (offset < bytes.length) {
      const read = fs.readSync(descriptor, bytes, offset, bytes.length - offset, null);
      if (read === 0) throw staleDirectoryError("existing project output was truncated");
      offset += read;
    }
    if (fs.readSync(descriptor, Buffer.alloc(1), 0, 1, null) !== 0)
      throw staleDirectoryError("existing project output grew during reconciliation");
    const after = fs.fstatSync(descriptor, { bigint: true });
    const linked = fs.lstatSync(file, { bigint: true });
    if (
      !after.isFile() ||
      after.nlink !== 1n ||
      linked.isSymbolicLink() ||
      !linked.isFile() ||
      linked.nlink !== 1n ||
      (Number(after.mode) & 0o777 & ~(allowedMode & 0o777)) !== 0 ||
      (Number(linked.mode) & 0o777 & ~(allowedMode & 0o777)) !== 0 ||
      !sameOwnerFile(before, after) ||
      !sameOwnerFile(after, linked) ||
      !bytes.equals(expected)
    ) {
      throw staleDirectoryError("existing project output changed during reconciliation");
    }
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function enterDirectory(component, mode) {
  let expected;
  let observedMissing = false;
  try {
    expected = fs.lstatSync(component, { bigint: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    observedMissing = true;
    try {
      fs.mkdirSync(component, { mode });
    } catch (mkdirError) {
      if (mkdirError.code !== "EEXIST") throw mkdirError;
    }
    expected = fs.lstatSync(component, { bigint: true });
  }
  if (expected.isSymbolicLink() || !expected.isDirectory())
    throw new Error(`project output ancestor is not a real directory: ${component}`);
  const durability = observedMissing ? fsyncDirectory() : { synced: true };
  if (!durability.synced && !UNSUPPORTED_DIRECTORY_SYNC_ERRORS.has(durability.errorCode)) {
    throw new Error(`project output ancestor sync failed (${durability.errorCode || "UNKNOWN"})`);
  }
  process.chdir(component);
  const entered = fs.statSync(".", { bigint: true });
  if (entered.dev !== expected.dev || entered.ino !== expected.ino)
    throw new Error(`project output ancestor changed during descent: ${component}`);
  return durability;
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
    const opened = fs.fstatSync(descriptor, { bigint: true });
    let offset = 0;
    while (offset < content.length) {
      const length = Math.min(DIRECTORY_WRITE_CHUNK_BYTES, content.length - offset);
      const written = fs.writeSync(descriptor, content, offset, length, null);
      if (written < 1) throw new Error(`project directory output file write stalled: ${name}`);
      offset += written;
    }
    fs.fsyncSync(descriptor);
    const afterWrite = fs.fstatSync(descriptor, { bigint: true });
    const finalStat = fs.lstatSync(name, { bigint: true });
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

function normalizeDirectoryFileName(name) {
  if (typeof name !== "string") throw new Error("directory output file name is invalid");
  if (
    name === DIRECTORY_OWNER_FILE ||
    name.startsWith(`${DIRECTORY_OWNER_FILE}.`) ||
    name === DIRECTORY_POINTER_FILE ||
    name.startsWith(`${DIRECTORY_POINTER_FILE}.`)
  )
    throw new Error("directory output file name is reserved for writer ownership");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(name))
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
    const failure = new Error(
      state?.message || (result.stderr || result.stdout || fallbackMessage).trim()
    );
    if (state?.committed === false) {
      failure.committed = false;
      failure.knownNonCommit = true;
      if (state.error_code) failure.code = state.error_code;
    }
    throw failure;
  }
  if (state?.committed !== true) {
    const failure = new Error(`${fallbackMessage}; child omitted committed state`);
    if (state?.committed === false) {
      failure.committed = false;
      failure.knownNonCommit = true;
      if (state.error_code) failure.code = state.error_code;
    }
    throw failure;
  }
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
      Object.keys(attestation).some(
        (field) => !["path", "sha256", "maxBytes", "allowManagedDirectoryPointers"].includes(field)
      ) ||
      (attestation.allowManagedDirectoryPointers !== undefined &&
        typeof attestation.allowManagedDirectoryPointers !== "boolean")
    )
      throw new Error("atomic write attestation is invalid");
    validateRelative(attestation.path);
    const normalizedPath = attestation.path.replaceAll("\\", "/");
    if (seen.has(normalizedPath)) throw new Error("atomic write attestation paths must be unique");
    seen.add(normalizedPath);
    if (!/^sha256:[a-f0-9]{64}$/.test(attestation.sha256 || ""))
      throw new Error("atomic write attestation sha256 is invalid");
    if (!Number.isSafeInteger(attestation.maxBytes) || attestation.maxBytes < 0)
      throw new Error("atomic write attestation maxBytes is invalid");
    return {
      path: normalizedPath,
      sha256: attestation.sha256,
      maxBytes: attestation.maxBytes,
      allowManagedDirectoryPointers: attestation.allowManagedDirectoryPointers === true,
    };
  });
}

function attestProjectInputs(root, attestations) {
  for (const attestation of normalizeAttestations(attestations)) {
    const input = readProjectInput(root, attestation.path, attestation.maxBytes, {
      allowManagedDirectoryPointers: attestation.allowManagedDirectoryPointers,
    });
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
      identicalPolicy,
      expectedRootDev,
      expectedRootIno,
      attestationsBase64,
      finalAttestationBase64,
    ] = argv;
    if (!new Set(["replace", "exclusive"]).has(policy)) throw new Error("invalid write policy");
    if (!new Set(["strict", "accept-identical"]).has(identicalPolicy))
      throw new Error("invalid identical-output policy");
    if (identicalPolicy === "accept-identical" && policy !== "exclusive")
      throw new Error("identical-output reconciliation requires exclusive publication");
    const content = fs.readFileSync(0);
    const state = writeFromAnchoredRoot(relativePath, content, {
      fileMode: Number(fileMode),
      directoryMode: Number(directoryMode),
      replace: policy === "replace",
      acceptIdentical: identicalPolicy === "accept-identical",
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
    } else {
      process.stdout.write(
        `${JSON.stringify({ committed: false, message: error.message, error_code: error.code || "UNKNOWN" })}\n`
      );
    }
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
    } else {
      process.stdout.write(
        `${JSON.stringify({ committed: false, message: error.message, error_code: error.code || "UNKNOWN" })}\n`
      );
    }
    return 1;
  }
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  if (argv[0] === "--child-directory") process.exitCode = childDirectoryMain(argv);
  else process.exitCode = childMain(argv);
}

module.exports = {
  acquireProjectWriteLock,
  writeProjectDirectoryAtomic,
  writeProjectFileAtomic,
  writeProjectJsonAtomic,
  writeProjectTextAtomic,
};
