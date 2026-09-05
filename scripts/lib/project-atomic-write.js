"use strict";

const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const v8 = require("node:v8");
const { acquireOwnedLock } = require("./owned-lock");
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
const DIRECTORY_OWNER_FILE = ".pm-directory-owner.json";
const DIRECTORY_RESERVATION_PREFIX = ".pm-dir-reservation-";
const MAX_DIRECTORY_OWNER_BYTES = 4096;
const DIRECTORY_WRITE_CHUNK_BYTES = 4 * 1024 * 1024;
const FILE_WRITE_LOCK_ATTEMPTS = 601;
const FILE_WRITE_LOCK_WAIT_MS = 50;
const STRONG_BOOT_TOKEN_KINDS = new Set(["linux-boot", "bsd-boot-numeric", "windows-boot"]);
const STRONG_PROCESS_TOKEN_KINDS = new Set(["linux-process", "bsd-process-utc", "windows-process"]);

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

function writeProjectFileAtomic(root, relativePath, content, options = {}) {
  const projectRoot = fs.realpathSync(path.resolve(root));
  validateRelative(relativePath);
  const normalizedRelativePath = relativePath.replaceAll("\\", "/");
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(String(content));
  const maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || bytes.length > maxBytes)
    throw new Error(`output exceeds ${maxBytes}-byte budget`);
  const rootStat = fs.statSync(projectRoot);
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

function reconcileDirectoryBundle(projectRoot, relativePath, files, commitFile) {
  const initial = inspectDirectoryBundle(projectRoot, relativePath, files, commitFile);
  if (initial.state !== "committed") return initial;
  try {
    fsyncContainedDirectory(projectRoot, relativePath);
  } catch (error) {
    return {
      state: "unknown",
      message: `the published bundle directory could not be synced: ${error.message}`,
    };
  }
  const durable = inspectDirectoryBundle(projectRoot, relativePath, files, commitFile);
  if (durable.state !== "committed") {
    return {
      state: "unknown",
      message: `the published bundle changed during durability reconciliation: ${durable.message || durable.state}`,
    };
  }
  return durable;
}

function inspectDirectoryBundle(projectRoot, relativePath, files, commitFile) {
  const marker = files.find((file) => file.name === commitFile);
  try {
    const observedMarker = readProjectInput(
      projectRoot,
      `${relativePath}/${commitFile}`,
      marker.content.length
    );
    if (!observedMarker.bytes.equals(marker.content))
      return {
        state: "unknown",
        message: "the published marker bytes differ from the requested commit marker",
      };
  } catch (error) {
    if (error.code === "ENOENT") return { state: "not-committed" };
    return { state: "unknown", message: error.message };
  }

  for (const file of files) {
    try {
      const observed = readProjectInput(
        projectRoot,
        `${relativePath}/${file.name}`,
        file.content.length
      );
      if (!observed.bytes.equals(file.content))
        return {
          state: "unknown",
          message: `the published bundle differs from the requested output: ${file.name}`,
        };
    } catch (error) {
      return {
        state: "unknown",
        message: `the published bundle cannot be verified: ${file.name}: ${error.message}`,
      };
    }
  }
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
  try {
    fsyncContainedDirectory(projectRoot, path.dirname(relativePath));
  } catch (error) {
    return {
      state: "unknown",
      message: `the published output directory could not be synced: ${error.message}`,
    };
  }
  const durable = inspect();
  if (durable.state !== "committed") {
    return {
      state: "unknown",
      message: `the public output changed during durability reconciliation: ${durable.message || durable.state}`,
    };
  }
  return durable;
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
    const opened = fs.fstatSync(descriptor);
    const published = fs.lstatSync(absolute);
    if (
      !opened.isDirectory() ||
      published.isSymbolicLink() ||
      !published.isDirectory() ||
      !sameInode(opened, published)
    )
      throw staleDirectoryError("directory sync path changed during inspection");
    fs.fsyncSync(descriptor);
    const after = fs.fstatSync(descriptor);
    const finalPath = fs.lstatSync(absolute);
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
  let ancestorsSynced = true;
  let ancestorSyncError = null;
  for (const part of parts) {
    const durability = enterDirectory(part, options.directoryMode ?? 0o777);
    ancestorsSynced &&= durability.synced;
    ancestorSyncError ||= durability.errorCode || null;
  }

  const parentStat = fs.statSync(".");
  const reservation = acquireDirectoryReservation(basename, commitFile);
  let reservationActive = true;
  let committed = false;
  let destinationStat = null;
  let ownerLease = null;
  let enteredDestination = false;
  try {
    // The sibling reservation must reach the parent directory before the
    // destination can.  Otherwise a crash could replay mkdir without the only
    // ownership record capable of recovering the pre-lease window.
    const reservationDurability = fsyncDirectory();
    if (
      !reservationDurability.synced &&
      !UNSUPPORTED_DIRECTORY_SYNC_ERRORS.has(reservationDurability.errorCode)
    )
      throw new Error(
        `project directory ownership reservation sync failed (${reservationDurability.errorCode || "UNKNOWN"})`
      );
    const recovered = recoverStaleDirectoryReservation(
      basename,
      commitFile,
      reservation,
      parentStat
    );
    if (recovered) {
      destinationStat = recovered.destinationStat;
      ownerLease = recovered.ownerLease;
    } else {
      fs.mkdirSync(basename, { mode: options.directoryMode ?? 0o777 });
      destinationStat = fs.lstatSync(basename);
      if (destinationStat.isSymbolicLink() || !destinationStat.isDirectory())
        throw new Error("project directory destination is not a real directory");
    }
    const parentDurability = fsyncDirectory();
    if (
      !parentDurability.synced &&
      !UNSUPPORTED_DIRECTORY_SYNC_ERRORS.has(parentDurability.errorCode)
    )
      throw new Error(
        `project directory reservation sync failed (${parentDurability.errorCode || "UNKNOWN"})`
      );

    process.chdir(basename);
    enteredDestination = true;
    const entered = fs.statSync(".");
    if (entered.dev !== destinationStat.dev || entered.ino !== destinationStat.ino)
      throw new Error("project directory destination changed during entry");
    assertPublishedDirectoryFromInside(basename, parentStat, destinationStat);
    if (ownerLease) assertDirectoryOwnerLease(".", destinationStat, ownerLease);
    else {
      ownerLease = createDirectoryOwnerLease(destinationStat, reservation, commitFile);
      const leaseDurability = fsyncDirectory();
      if (
        !leaseDurability.synced &&
        !UNSUPPORTED_DIRECTORY_SYNC_ERRORS.has(leaseDurability.errorCode)
      )
        throw new Error(
          `project directory owner lease sync failed (${leaseDurability.errorCode || "UNKNOWN"})`
        );
    }
    assertPublishedDirectoryFromInside(basename, parentStat, destinationStat);
    releaseDirectoryReservation("..", reservation);
    reservationActive = false;

    const writerState = writeDirectoryFiles(payload, {
      expectedRootDev: destinationStat.dev,
      expectedRootIno: destinationStat.ino,
      fileMode: options.fileMode,
      maxBytes: options.maxBytes,
      commitFile,
      ownerLease,
    });
    committed = true;

    const observedDestination = fs.statSync(".");
    if (
      observedDestination.dev !== destinationStat.dev ||
      observedDestination.ino !== destinationStat.ino
    )
      throw new Error("project directory destination changed after commit");
    const anchoredRoot = fs.statSync(projectRoot);
    if (anchoredRoot.dev !== rootStat.dev || anchoredRoot.ino !== rootStat.ino)
      throw new Error("project root changed after directory commit");
    const directorySynced =
      ancestorsSynced && writerState.directory_synced === true && parentDurability.synced === true;
    const directorySyncError =
      ancestorSyncError || writerState.directory_sync_error || parentDurability.errorCode || null;
    return {
      committed: true,
      directory_synced: directorySynced,
      ...(directorySyncError ? { directory_sync_error: directorySyncError } : {}),
    };
  } catch (error) {
    if (error.committed === true) committed = true;
    let cleanupError = null;
    if (enteredDestination) {
      try {
        const current = fs.statSync(".");
        if (!destinationStat || !sameInode(current, destinationStat)) throw staleDirectoryError();
        process.chdir("..");
        enteredDestination = false;
        const observedParent = fs.statSync(".");
        if (!sameInode(observedParent, parentStat)) throw staleDirectoryError();
      } catch (exitError) {
        cleanupError = exitError;
      }
    }
    if (reservationActive)
      try {
        releaseDirectoryReservation(enteredDestination ? ".." : ".", reservation);
        reservationActive = false;
      } catch (releaseError) {
        cleanupError ||= releaseError;
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
  const observedParent = fs.statSync("..");
  if (!sameInode(observedParent, expectedParent))
    throw staleDirectoryError("project directory destination parent changed");
  const published = fs.lstatSync(path.join("..", basename));
  if (
    published.isSymbolicLink() ||
    !published.isDirectory() ||
    !sameInode(published, expectedDestination)
  )
    throw staleDirectoryError("project directory destination changed at its published path");
}

function identityDigest(kind, value) {
  return `${kind}:${crypto.createHash("sha256").update(String(value).trim()).digest("hex")}`;
}

function strongIdentityTokensDiffer(left, right, knownKinds) {
  const leftKind = typeof left === "string" ? left.slice(0, left.indexOf(":")) : "";
  const rightKind = typeof right === "string" ? right.slice(0, right.indexOf(":")) : "";
  return leftKind === rightKind && knownKinds.has(leftKind) && left !== right;
}

function strongBootTokensDiffer(left, right) {
  return strongIdentityTokensDiffer(left, right, STRONG_BOOT_TOKEN_KINDS);
}

function strongProcessTokensDiffer(left, right) {
  return strongIdentityTokensDiffer(left, right, STRONG_PROCESS_TOKEN_KINDS);
}

function stableProcessIdentityEnvironment() {
  return { ...process.env, LC_ALL: "C", LANG: "C", TZ: "UTC" };
}

function machineBootToken() {
  try {
    if (process.platform === "linux")
      return identityDigest(
        "linux-boot",
        fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8")
      );
    if (process.platform === "darwin" || process.platform === "freebsd") {
      const result = spawnSync("/usr/sbin/sysctl", ["-n", "kern.boottime"], {
        encoding: "utf8",
        timeout: 1_000,
        maxBuffer: 4096,
      });
      if (!result.error && result.status === 0) {
        const bootTime = result.stdout.match(/\bsec\s*=\s*(\d+)\s*,\s*usec\s*=\s*(\d+)/);
        if (bootTime)
          return identityDigest(
            "bsd-boot-numeric",
            `${BigInt(bootTime[1])}:${BigInt(bootTime[2])}`
          );
      }
    }
    if (process.platform === "win32") {
      const result = spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().Ticks",
        ],
        { encoding: "utf8", timeout: 2_000, maxBuffer: 4096 }
      );
      if (!result.error && result.status === 0 && result.stdout.trim())
        return identityDigest("windows-boot", result.stdout);
    }
  } catch {
    // Missing platform identity support degrades to the process probe below.
  }
  try {
    const approximateBootMinute = Math.round((Date.now() - os.uptime() * 1000) / 60_000);
    return identityDigest("uptime-boot", approximateBootMinute);
  } catch {
    return null;
  }
}

function processStartToken(pid) {
  try {
    if (process.platform === "linux") {
      const raw = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
      const commandEnd = raw.lastIndexOf(") ");
      const fields =
        commandEnd === -1
          ? []
          : raw
              .slice(commandEnd + 2)
              .trim()
              .split(/\s+/);
      if (!/^\d+$/.test(fields[19] || "")) return null;
      return identityDigest("linux-process", fields[19]);
    }
    if (process.platform === "darwin" || process.platform === "freebsd") {
      const result = spawnSync("/bin/ps", ["-o", "lstart=", "-p", String(pid)], {
        encoding: "utf8",
        timeout: 1_000,
        maxBuffer: 4096,
        env: stableProcessIdentityEnvironment(),
      });
      if (!result.error && result.status === 0 && result.stdout.trim())
        return identityDigest("bsd-process-utc", result.stdout);
      return null;
    }
    if (process.platform === "win32") {
      const result = spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`,
        ],
        { encoding: "utf8", timeout: 2_000, maxBuffer: 4096 }
      );
      if (!result.error && result.status === 0 && result.stdout.trim())
        return identityDigest("windows-process", result.stdout);
    }
  } catch {
    // A disappearing or uninspectable process is handled conservatively below.
  }
  return null;
}

function ownerProcessMayBeAlive(ownerLease) {
  const currentBootToken = machineBootToken();
  if (strongBootTokensDiffer(ownerLease.boot_token, currentBootToken)) return false;
  try {
    process.kill(ownerLease.pid, 0);
  } catch (error) {
    return error.code !== "ESRCH";
  }
  const currentProcessToken = processStartToken(ownerLease.pid);
  if (strongProcessTokensDiffer(ownerLease.process_start_token, currentProcessToken)) return false;
  if (
    ownerLease.process_start_token &&
    currentProcessToken &&
    ownerLease.process_start_token === currentProcessToken
  )
    return true;
  // A stale wall-clock lease is not proof that a live writer is safe to remove:
  // the writer may be blocked in fsync or the host clock may have jumped.  When
  // the PID exists but this platform cannot prove its process identity, fail
  // closed.  Supported platforms reclaim PID reuse through the boot/start
  // tokens above, and an exited process through ESRCH.
  return true;
}

function readDirectoryOwnerLease(directory, expectedDestination, expectedCommitFile) {
  const leasePath = path.join(directory, DIRECTORY_OWNER_FILE);
  let descriptor;
  try {
    descriptor = fs.openSync(
      leasePath,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0)
    );
    const before = fs.fstatSync(descriptor, { bigint: true });
    if (!before.isFile() || before.size < 1n || before.size > BigInt(MAX_DIRECTORY_OWNER_BYTES))
      throw new Error("project directory owner lease is not a bounded regular file");
    const bytes = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const read = fs.readSync(descriptor, bytes, offset, bytes.length - offset, null);
      if (read === 0) throw staleDirectoryError("project directory owner lease was truncated");
      offset += read;
    }
    const overflow = Buffer.alloc(1);
    if (fs.readSync(descriptor, overflow, 0, 1, null) !== 0)
      throw new Error("project directory owner lease exceeds its bounded size");
    const after = fs.fstatSync(descriptor, { bigint: true });
    const linked = fs.lstatSync(leasePath, { bigint: true });
    if (!sameOwnerFile(before, after) || !sameOwnerFile(after, linked))
      throw staleDirectoryError("project directory owner lease changed during inspection");
    let value;
    try {
      value = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new Error("project directory owner lease is invalid JSON");
    }
    let commitFile = null;
    try {
      commitFile = normalizeDirectoryFileName(value?.commit_file);
    } catch {
      // Report all malformed fields through the shape error below.
    }
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).sort().join(",") !==
        "boot_token,commit_file,created_at_ms,destination_dev,destination_ino,nonce,pid,process_start_token,schema_version" ||
      value.schema_version !== 2 ||
      commitFile !== value.commit_file ||
      !/^[a-f0-9]{48}$/.test(value.nonce || "") ||
      !Number.isSafeInteger(value.pid) ||
      value.pid < 2 ||
      !Number.isSafeInteger(value.created_at_ms) ||
      value.created_at_ms < 0 ||
      typeof value.destination_dev !== "string" ||
      typeof value.destination_ino !== "string" ||
      (value.boot_token !== null && !/^[a-z-]+:[a-f0-9]{64}$/.test(value.boot_token || "")) ||
      (value.process_start_token !== null &&
        !/^[a-z-]+:[a-f0-9]{64}$/.test(value.process_start_token || ""))
    )
      throw new Error("project directory owner lease shape is invalid");
    if (
      value.destination_dev !== String(expectedDestination.dev) ||
      value.destination_ino !== String(expectedDestination.ino)
    )
      throw staleDirectoryError("project directory owner lease targets another directory");
    if (expectedCommitFile !== undefined && value.commit_file !== expectedCommitFile)
      throw staleDirectoryError("project directory owner lease targets another commit marker");
    return { ...value, owner_file: after };
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function directoryOwnerLeaseValue(destinationStat, reservation, commitFile) {
  const normalizedCommitFile = normalizeDirectoryFileName(commitFile);
  if (reservation.commit_file !== normalizedCommitFile)
    throw staleDirectoryError("project directory reservation commit marker changed");
  return {
    schema_version: 2,
    nonce: reservation.nonce,
    pid: reservation.pid,
    created_at_ms: reservation.created_at_ms || Date.now(),
    destination_dev: String(destinationStat.dev),
    destination_ino: String(destinationStat.ino),
    commit_file: normalizedCommitFile,
    boot_token: reservation.boot_token,
    process_start_token: reservation.process_start_token,
  };
}

function createDirectoryOwnerLease(destinationStat, reservation, commitFile) {
  const value = directoryOwnerLeaseValue(destinationStat, reservation, commitFile);
  writeExclusiveDirectoryFile(
    DIRECTORY_OWNER_FILE,
    Buffer.from(`${JSON.stringify(value)}\n`),
    0o600
  );
  return readDirectoryOwnerLease(".", destinationStat, value.commit_file);
}

function replaceDirectoryOwnerLease(destinationStat, reservation, commitFile, expectedLease) {
  const value = directoryOwnerLeaseValue(destinationStat, reservation, commitFile);
  const candidate = `${DIRECTORY_OWNER_FILE}.candidate-${process.pid}-${reservation.nonce.slice(
    0,
    16
  )}`;
  let candidateStat = null;
  let replaced = false;
  let ownerLease = null;
  let failure = null;
  try {
    candidateStat = writeExclusiveDirectoryFile(
      candidate,
      Buffer.from(`${JSON.stringify(value)}\n`),
      0o600
    );
    assertCommitMarkerAbsent(".", value.commit_file);
    assertDirectoryOwnerLease(".", destinationStat, expectedLease);
    if (ownerProcessMayBeAlive(expectedLease))
      throw new Error(`project directory output is reserved by live writer ${expectedLease.pid}`);
    assertDirectoryReservation("..", reservation.basename, reservation);
    fs.renameSync(candidate, DIRECTORY_OWNER_FILE);
    replaced = true;
    ownerLease = readDirectoryOwnerLease(".", destinationStat, value.commit_file);
  } catch (error) {
    failure = error;
  }
  if (!replaced && candidateStat)
    try {
      const cleanup = fs.lstatSync(candidate);
      if (cleanup.isSymbolicLink() || !cleanup.isFile() || !sameInode(cleanup, candidateStat))
        throw staleDirectoryError("project directory owner lease candidate changed");
      fs.unlinkSync(candidate);
    } catch (error) {
      if (error.code !== "ENOENT") failure ||= error;
    }
  if (failure) throw failure;
  return ownerLease;
}

function assertDirectoryOwnerLease(directory, destinationStat, expectedLease) {
  const observed = readDirectoryOwnerLease(directory, destinationStat, expectedLease.commit_file);
  if (
    observed.nonce !== expectedLease.nonce ||
    observed.pid !== expectedLease.pid ||
    observed.created_at_ms !== expectedLease.created_at_ms ||
    observed.commit_file !== expectedLease.commit_file ||
    observed.boot_token !== expectedLease.boot_token ||
    observed.process_start_token !== expectedLease.process_start_token ||
    !sameOwnerFile(observed.owner_file, expectedLease.owner_file)
  )
    throw staleDirectoryError("project directory owner lease changed; cleanup skipped");
  return observed;
}

function directoryReservationName(basename) {
  return `${DIRECTORY_RESERVATION_PREFIX}${crypto
    .createHash("sha256")
    .update(basename)
    .digest("hex")
    .slice(0, 32)}.json`;
}

function readDirectoryReservation(directory, basename, expectedCommitFile) {
  const reservationPath = path.join(directory, directoryReservationName(basename));
  let descriptor;
  try {
    descriptor = fs.openSync(
      reservationPath,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0)
    );
    const before = fs.fstatSync(descriptor, { bigint: true });
    if (!before.isFile() || before.size < 1n || before.size > BigInt(MAX_DIRECTORY_OWNER_BYTES))
      throw new Error("project directory reservation is not a bounded regular file");
    const bytes = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const read = fs.readSync(descriptor, bytes, offset, bytes.length - offset, null);
      if (read === 0) throw staleDirectoryError("project directory reservation was truncated");
      offset += read;
    }
    if (fs.readSync(descriptor, Buffer.alloc(1), 0, 1, null) !== 0)
      throw new Error("project directory reservation exceeds its bounded size");
    const after = fs.fstatSync(descriptor, { bigint: true });
    const linked = fs.lstatSync(reservationPath, { bigint: true });
    if (!sameOwnerFile(before, after) || !sameOwnerFile(after, linked))
      throw staleDirectoryError("project directory reservation changed during inspection");
    let value;
    try {
      value = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new Error("project directory reservation is invalid JSON");
    }
    let commitFile = null;
    try {
      commitFile = normalizeDirectoryFileName(value?.commit_file);
    } catch {
      // Report all malformed fields through the shape error below.
    }
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).sort().join(",") !==
        "basename_sha256,boot_token,commit_file,created_at_ms,nonce,pid,process_start_token,schema_version" ||
      value.schema_version !== 2 ||
      commitFile !== value.commit_file ||
      value.basename_sha256 !== crypto.createHash("sha256").update(basename).digest("hex") ||
      !/^[a-f0-9]{48}$/.test(value.nonce || "") ||
      !Number.isSafeInteger(value.pid) ||
      value.pid < 2 ||
      !Number.isSafeInteger(value.created_at_ms) ||
      (value.boot_token !== null && !/^[a-z-]+:[a-f0-9]{64}$/.test(value.boot_token || "")) ||
      (value.process_start_token !== null &&
        !/^[a-z-]+:[a-f0-9]{64}$/.test(value.process_start_token || ""))
    )
      throw new Error("project directory reservation shape is invalid");
    if (expectedCommitFile !== undefined && value.commit_file !== expectedCommitFile)
      throw staleDirectoryError("project directory reservation targets another commit marker");
    return {
      ...value,
      owner_file: after,
      file_name: directoryReservationName(basename),
      basename,
    };
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function assertDirectoryReservation(directory, basename, expected) {
  const observed = readDirectoryReservation(directory, basename, expected.commit_file);
  if (
    observed.nonce !== expected.nonce ||
    observed.pid !== expected.pid ||
    observed.created_at_ms !== expected.created_at_ms ||
    observed.commit_file !== expected.commit_file ||
    observed.boot_token !== expected.boot_token ||
    observed.process_start_token !== expected.process_start_token ||
    !sameOwnerFile(observed.owner_file, expected.owner_file)
  )
    throw staleDirectoryError("project directory reservation owner changed");
  return observed;
}

function createDirectoryReservation(basename, commitFile) {
  const createdAt = Date.now();
  const value = {
    schema_version: 2,
    basename_sha256: crypto.createHash("sha256").update(basename).digest("hex"),
    commit_file: normalizeDirectoryFileName(commitFile),
    nonce: crypto.randomBytes(24).toString("hex"),
    pid: process.pid,
    created_at_ms: createdAt,
    boot_token: machineBootToken(),
    process_start_token: processStartToken(process.pid),
  };
  const reservationName = directoryReservationName(basename);
  const candidate = `${DIRECTORY_RESERVATION_PREFIX}candidate-${process.pid}-${value.nonce.slice(
    0,
    16
  )}`;
  let published = false;
  let candidateRemoved = false;
  let reservation = null;
  let failure = null;
  try {
    writeExclusiveDirectoryFile(candidate, Buffer.from(`${JSON.stringify(value)}\n`), 0o600);
    fs.linkSync(candidate, reservationName);
    published = true;
    fs.unlinkSync(candidate);
    candidateRemoved = true;
    reservation = readDirectoryReservation(".", basename, value.commit_file);
    if (
      reservation.nonce !== value.nonce ||
      reservation.pid !== value.pid ||
      reservation.created_at_ms !== value.created_at_ms ||
      reservation.commit_file !== value.commit_file
    )
      throw staleDirectoryError("project directory reservation changed during publication");
  } catch (error) {
    failure = error;
  }
  if (!candidateRemoved)
    try {
      fs.unlinkSync(candidate);
    } catch (error) {
      if (error.code !== "ENOENT" && !published && !failure) failure = error;
    }
  if (failure) throw failure;
  return reservation;
}

function releaseDirectoryReservation(directory, reservation) {
  assertDirectoryReservation(directory, reservation.basename, reservation);
  fs.unlinkSync(path.join(directory, reservation.file_name));
}

function reclaimDirectoryReservation(reservation) {
  const commitFile = reservation.commit_file;
  if (ownerProcessMayBeAlive(reservation))
    throw new Error(`project directory output is reserved by live writer ${reservation.pid}`);
  assertDirectoryReservation(".", reservation.basename, reservation);

  let destinationStat;
  try {
    destinationStat = fs.lstatSync(reservation.basename);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (destinationStat) {
    if (destinationStat.isSymbolicLink() || !destinationStat.isDirectory())
      throw new Error("project directory output already exists and is not a real directory");
    try {
      fs.lstatSync(path.join(reservation.basename, commitFile));
      releaseDirectoryReservation(".", reservation);
      return;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }

    let ownerLease;
    try {
      ownerLease = readDirectoryOwnerLease(reservation.basename, destinationStat);
    } catch (error) {
      throw new Error(
        `project directory output already exists without a recoverable owner lease: ${error.message}`
      );
    }
    const foreignOwner =
      ownerLease.nonce !== reservation.nonce ||
      ownerLease.pid !== reservation.pid ||
      ownerLease.created_at_ms !== reservation.created_at_ms ||
      ownerLease.commit_file !== reservation.commit_file ||
      ownerLease.boot_token !== reservation.boot_token ||
      ownerLease.process_start_token !== reservation.process_start_token;
    if (foreignOwner) {
      assertDirectoryOwnerLease(reservation.basename, destinationStat, ownerLease);
      if (ownerProcessMayBeAlive(ownerLease))
        throw new Error(`project directory output is reserved by live writer ${ownerLease.pid}`);
    }
  }

  assertDirectoryReservation(".", reservation.basename, reservation);
  if (ownerProcessMayBeAlive(reservation))
    throw new Error(`project directory output is reserved by live writer ${reservation.pid}`);
  releaseDirectoryReservation(".", reservation);
}

function acquireDirectoryReservation(basename, commitFile) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return createDirectoryReservation(basename, commitFile);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let reservation;
      try {
        reservation = readDirectoryReservation(".", basename, commitFile);
      } catch (readError) {
        throw new Error(
          `project directory output has an invalid reservation: ${readError.message}`
        );
      }
      reclaimDirectoryReservation(reservation);
    }
  }
  throw new Error("project directory output reservation could not be acquired");
}

function assertCommitMarkerAbsent(directory, commitFile) {
  try {
    fs.lstatSync(path.join(directory, commitFile));
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  throw new Error("project directory output already exists");
}

function recoverStaleDirectoryReservation(basename, commitFile, reservation, parentStat) {
  let destinationStat;
  try {
    destinationStat = fs.lstatSync(basename);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  if (destinationStat.isSymbolicLink() || !destinationStat.isDirectory())
    throw new Error("project directory output already exists and is not a real directory");
  assertCommitMarkerAbsent(basename, commitFile);
  let ownerLease;
  try {
    ownerLease = readDirectoryOwnerLease(basename, destinationStat, commitFile);
  } catch (error) {
    throw new Error(
      `project directory output already exists without a recoverable owner lease: ${error.message}`
    );
  }
  if (ownerProcessMayBeAlive(ownerLease))
    throw new Error(`project directory output is reserved by live writer ${ownerLease.pid}`);
  assertCommitMarkerAbsent(basename, commitFile);
  assertDirectoryOwnerLease(basename, destinationStat, ownerLease);

  let entered = false;
  let recovered = null;
  let failure = null;
  try {
    process.chdir(basename);
    entered = true;
    const anchored = fs.statSync(".");
    if (!sameInode(anchored, destinationStat))
      throw staleDirectoryError("project directory destination changed during recovery entry");
    assertPublishedDirectoryFromInside(basename, parentStat, destinationStat);
    assertCommitMarkerAbsent(".", commitFile);
    assertDirectoryOwnerLease(".", destinationStat, ownerLease);
    assertDirectoryReservation("..", reservation.basename, reservation);
    if (ownerProcessMayBeAlive(ownerLease))
      throw new Error(`project directory output is reserved by live writer ${ownerLease.pid}`);

    const entries = readBoundedDirectoryEntries(
      ".",
      MAX_DIRECTORY_FILES + 2,
      "project directory reservation"
    );
    if (!entries.includes(DIRECTORY_OWNER_FILE))
      throw staleDirectoryError("project directory owner lease disappeared before recovery");
    if (entries.includes(commitFile)) throw new Error("project directory output already exists");
    for (const entry of entries) {
      const stat = fs.lstatSync(entry);
      if (stat.isSymbolicLink() || !stat.isFile())
        throw staleDirectoryError(
          `project directory reservation contains unsafe recovery entry: ${entry}`
        );
    }
    assertDirectoryOwnerLease(".", destinationStat, ownerLease);
    assertDirectoryReservation("..", reservation.basename, reservation);
    if (ownerProcessMayBeAlive(ownerLease))
      throw new Error(`project directory output is reserved by live writer ${ownerLease.pid}`);
    assertPublishedDirectoryFromInside(basename, parentStat, destinationStat);

    for (const entry of entries) {
      if (entry === DIRECTORY_OWNER_FILE) continue;
      assertCommitMarkerAbsent(".", commitFile);
      fs.unlinkSync(entry);
      assertCommitMarkerAbsent(".", commitFile);
    }
    assertDirectoryOwnerLease(".", destinationStat, ownerLease);
    assertDirectoryReservation("..", reservation.basename, reservation);
    if (ownerProcessMayBeAlive(ownerLease))
      throw new Error(`project directory output is reserved by live writer ${ownerLease.pid}`);
    assertPublishedDirectoryFromInside(basename, parentStat, destinationStat);
    const replacementLease = replaceDirectoryOwnerLease(
      destinationStat,
      reservation,
      commitFile,
      ownerLease
    );
    const durability = fsyncDirectory();
    if (!durability.synced && !UNSUPPORTED_DIRECTORY_SYNC_ERRORS.has(durability.errorCode))
      throw new Error(
        `project directory recovery sync failed (${durability.errorCode || "UNKNOWN"})`
      );
    assertCommitMarkerAbsent(".", commitFile);
    assertDirectoryOwnerLease(".", destinationStat, replacementLease);
    assertDirectoryReservation("..", reservation.basename, reservation);
    assertPublishedDirectoryFromInside(basename, parentStat, destinationStat);
    recovered = { destinationStat, ownerLease: replacementLease };
  } catch (error) {
    failure = error;
  }
  if (entered)
    try {
      process.chdir("..");
      entered = false;
    } catch (error) {
      failure ||= error;
    }
  if (!failure) {
    const observedParent = fs.statSync(".");
    if (!sameInode(observedParent, parentStat))
      failure = staleDirectoryError("project directory recovery parent changed");
    else {
      const published = fs.lstatSync(basename);
      if (
        published.isSymbolicLink() ||
        !published.isDirectory() ||
        !sameInode(published, destinationStat)
      )
        failure = staleDirectoryError("project directory destination changed after recovery");
    }
  }
  if (failure) throw failure;
  return recovered;
}

function removeDirectoryOwnerLease(ownerLease) {
  assertDirectoryOwnerLease(".", fs.statSync("."), ownerLease);
  fs.unlinkSync(DIRECTORY_OWNER_FILE);
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
  if (options.ownerLease?.commit_file !== commitFile)
    throw staleDirectoryError("project directory owner lease targets another commit marker");
  let markerPublished = false;
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
    markerPublished = true;
    // Persist the marker link before removing the owner lease.  After this
    // barrier, every crash boundary is unambiguously committed even if the
    // lease unlink is replayed independently.
    const markerDurability = fsyncDirectory();
    if (
      !markerDurability.synced &&
      !UNSUPPORTED_DIRECTORY_SYNC_ERRORS.has(markerDurability.errorCode)
    ) {
      const failure = new Error(
        `project directory committed but marker sync failed (${markerDurability.errorCode || "UNKNOWN"}); do not retry this write`
      );
      failure.committed = true;
      failure.code = markerDurability.errorCode || "UNKNOWN";
      throw failure;
    }
    if (options.ownerLease) removeDirectoryOwnerLease(options.ownerLease);
    const leaseRemovalDurability = fsyncDirectory();
    if (
      !leaseRemovalDurability.synced &&
      !UNSUPPORTED_DIRECTORY_SYNC_ERRORS.has(leaseRemovalDurability.errorCode)
    ) {
      const failure = new Error(
        `project directory committed but owner lease removal sync failed (${leaseRemovalDurability.errorCode || "UNKNOWN"}); do not retry this write`
      );
      failure.committed = true;
      failure.code = leaseRemovalDurability.errorCode || "UNKNOWN";
      throw failure;
    }
    const directorySyncError =
      markerDurability.errorCode || leaseRemovalDurability.errorCode || null;
    return {
      committed: true,
      directory_synced: markerDurability.synced && leaseRemovalDurability.synced,
      ...(directorySyncError ? { directory_sync_error: directorySyncError } : {}),
    };
  } catch (error) {
    if (markerPublished) error.committed = true;
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
  let ancestorsSynced = true;
  let ancestorSyncError = null;
  for (const part of parts) {
    const durability = enterDirectory(part, options.directoryMode ?? 0o777);
    ancestorsSynced &&= durability.synced;
    ancestorSyncError ||= durability.errorCode || null;
  }

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

function enterDirectory(component, mode) {
  let expected;
  let observedMissing = false;
  try {
    expected = fs.lstatSync(component);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    observedMissing = true;
    try {
      fs.mkdirSync(component, { mode });
    } catch (mkdirError) {
      if (mkdirError.code !== "EEXIST") throw mkdirError;
    }
    expected = fs.lstatSync(component);
  }
  if (expected.isSymbolicLink() || !expected.isDirectory())
    throw new Error(`project output ancestor is not a real directory: ${component}`);
  const durability = observedMissing ? fsyncDirectory() : { synced: true };
  if (!durability.synced && !UNSUPPORTED_DIRECTORY_SYNC_ERRORS.has(durability.errorCode)) {
    throw new Error(`project output ancestor sync failed (${durability.errorCode || "UNKNOWN"})`);
  }
  process.chdir(component);
  const entered = fs.statSync(".");
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
    const opened = fs.fstatSync(descriptor);
    let offset = 0;
    while (offset < content.length) {
      const length = Math.min(DIRECTORY_WRITE_CHUNK_BYTES, content.length - offset);
      const written = fs.writeSync(descriptor, content, offset, length, null);
      if (written < 1) throw new Error(`project directory output file write stalled: ${name}`);
      offset += written;
    }
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

function readBoundedDirectoryEntries(directory, limit, label) {
  const entries = [];
  const handle = fs.opendirSync(directory);
  try {
    while (true) {
      const entry = handle.readSync();
      if (!entry) return entries;
      if (entries.length >= limit)
        throw staleDirectoryError(`${label} has too many files to reclaim`);
      entries.push(entry.name);
    }
  } finally {
    handle.closeSync();
  }
}

function normalizeDirectoryFileName(name) {
  if (typeof name !== "string") throw new Error("directory output file name is invalid");
  if (name === DIRECTORY_OWNER_FILE || name.startsWith(`${DIRECTORY_OWNER_FILE}.`))
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
      Object.keys(attestation).some((field) => !["path", "sha256", "maxBytes"].includes(field))
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
  writeProjectDirectoryAtomic,
  writeProjectFileAtomic,
  writeProjectJsonAtomic,
  writeProjectTextAtomic,
};
