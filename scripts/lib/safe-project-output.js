"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { readDescriptorBounded } = require("./bounded-descriptor-read");

const MANAGED_DIRECTORY_POINTER_FILE = ".pm-directory-pointer.json";
const MANAGED_DIRECTORY_OWNER_FILE = ".pm-directory-owner.json";
const MANAGED_DIRECTORY_BUNDLE_PREFIX = ".pm-dir-bundle-";
const MAX_MANAGED_DIRECTORY_POINTER_BYTES = 64 * 1024;
const MAX_MANAGED_DIRECTORY_FILES = 64;
const MAX_MANAGED_DIRECTORY_PAYLOAD_BYTES = 128 * 1024 * 1024;
const MAX_ANCESTOR_CHURN_ATTEMPTS = 128;
const ANCESTOR_CHURN_RETRY_WINDOW_NS = 500_000_000n;
const ANCESTOR_CHURN_RETRY_DELAY_MS = 5;
const ANCESTOR_CHURN_WAIT_WORD = new Int32Array(new SharedArrayBuffer(4));
const RETRYABLE_ANCESTOR_CHURN = Symbol("retryable ancestor churn");

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

function sameFileMetadata(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

function sameStableDirectoryIdentity(left, right) {
  return (
    left.isDirectory() &&
    right.isDirectory() &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.uid === right.uid &&
    left.gid === right.gid
  );
}

function sameComponents(expected, observed) {
  return (
    expected.length === observed.length &&
    expected.every(
      (component, index) =>
        component.path === observed[index].path &&
        component.kind === observed[index].kind &&
        sameComponentMetadata(component.stat, observed[index].stat)
    )
  );
}

function sameLogicalComponentsIgnoringAncestorEntryChurn(expected, observed) {
  return (
    expected.length === observed.length &&
    expected.every(
      (component, index) =>
        component.path === observed[index].path &&
        component.kind === observed[index].kind &&
        (["root", "ancestor"].includes(component.kind)
          ? sameStableDirectoryIdentity(component.stat, observed[index].stat)
          : sameComponentMetadata(component.stat, observed[index].stat))
    )
  );
}

function stablePathIdentity(snapshot) {
  const components = [...snapshot.logicalComponents, ...snapshot.physicalComponents];
  return JSON.stringify({
    components: components.map(({ path: componentPath, kind, stat }) => [
      componentPath,
      kind,
      stat.dev.toString(),
      stat.ino.toString(),
      stat.mode.toString(),
      stat.nlink.toString(),
      stat.uid.toString(),
      stat.gid.toString(),
      stat.size.toString(),
      stat.mtimeNs.toString(),
      stat.ctimeNs.toString(),
    ]),
    pointer: snapshot.managed
      ? {
          text: snapshot.managed.targetText,
          manifest_sha256: snapshot.managed.manifestSha256,
        }
      : null,
  });
}

function sameSnapshots(expected, observed) {
  return (
    expected.absolute === observed.absolute &&
    expected.physicalAbsolute === observed.physicalAbsolute &&
    sameComponents(expected.logicalComponents, observed.logicalComponents) &&
    sameComponents(expected.physicalComponents, observed.physicalComponents) &&
    Boolean(expected.managed) === Boolean(observed.managed) &&
    (!expected.managed ||
      (expected.managed.targetText === observed.managed.targetText &&
        expected.managed.manifestSha256 === observed.managed.manifestSha256 &&
        expected.managed.requestedFile.sha256 === observed.managed.requestedFile.sha256 &&
        expected.managed.requestedFile.size === observed.managed.requestedFile.size))
  );
}

function sameSnapshotsIgnoringAncestorEntryChurn(expected, observed) {
  return (
    expected.absolute === observed.absolute &&
    expected.physicalAbsolute === observed.physicalAbsolute &&
    sameLogicalComponentsIgnoringAncestorEntryChurn(
      expected.logicalComponents,
      observed.logicalComponents
    ) &&
    sameComponents(expected.physicalComponents, observed.physicalComponents) &&
    Boolean(expected.managed) === Boolean(observed.managed) &&
    (!expected.managed ||
      (expected.managed.targetText === observed.managed.targetText &&
        expected.managed.manifestSha256 === observed.managed.manifestSha256 &&
        expected.managed.requestedFile.sha256 === observed.managed.requestedFile.sha256 &&
        expected.managed.requestedFile.size === observed.managed.requestedFile.size))
  );
}

function assertStableSnapshot(expected, observed, message) {
  if (sameSnapshots(expected, observed)) return;
  const error = new Error(message);
  if (sameSnapshotsIgnoringAncestorEntryChurn(expected, observed)) {
    error[RETRYABLE_ANCESTOR_CHURN] = expected;
  }
  throw error;
}

function retryAncestorEntryChurn(operation) {
  const deadline = process.hrtime.bigint() + ANCESTOR_CHURN_RETRY_WINDOW_NS;
  let baseline;
  let lastError;
  for (let attempt = 0; attempt < MAX_ANCESTOR_CHURN_ATTEMPTS; attempt += 1) {
    try {
      return operation(baseline);
    } catch (error) {
      const retryBaseline = error?.[RETRYABLE_ANCESTOR_CHURN];
      if (!retryBaseline) throw error;
      baseline ??= retryBaseline;
      lastError = error;
      if (attempt === MAX_ANCESTOR_CHURN_ATTEMPTS - 1 || process.hrtime.bigint() >= deadline) break;
      Atomics.wait(ANCESTOR_CHURN_WAIT_WORD, 0, 0, ANCESTOR_CHURN_RETRY_DELAY_MS);
    }
  }
  throw lastError;
}

function assertRetryBaseline(baseline, observed, message) {
  if (baseline && !sameSnapshotsIgnoringAncestorEntryChurn(baseline, observed)) {
    throw new Error(message);
  }
}

function managedDirectoryBundleName(canonicalBasename, nonce) {
  return `${MANAGED_DIRECTORY_BUNDLE_PREFIX}${crypto
    .createHash("sha256")
    .update(canonicalBasename)
    .digest("hex")
    .slice(0, 32)}-${nonce}`;
}

function isPortableManagedFileName(value) {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(value) &&
    value !== MANAGED_DIRECTORY_POINTER_FILE &&
    !value.startsWith(`${MANAGED_DIRECTORY_POINTER_FILE}.`) &&
    value !== MANAGED_DIRECTORY_OWNER_FILE &&
    !value.startsWith(`${MANAGED_DIRECTORY_OWNER_FILE}.`)
  );
}

function readManagedDirectoryManifest(
  bundlePath,
  bundleStat,
  canonicalBasename,
  targetBasename,
  verifyPayloadHashes
) {
  const manifestPath = path.join(bundlePath, MANAGED_DIRECTORY_POINTER_FILE);
  let descriptor;
  let bytes;
  let manifestStat;
  try {
    descriptor = fs.openSync(
      manifestPath,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0)
    );
    const before = fs.fstatSync(descriptor, { bigint: true });
    if (
      !before.isFile() ||
      before.nlink !== 1n ||
      before.size < 1n ||
      before.size > BigInt(MAX_MANAGED_DIRECTORY_POINTER_BYTES)
    )
      throw new Error("managed project directory manifest is not a bounded regular file");
    bytes = readDescriptorBounded(descriptor, MAX_MANAGED_DIRECTORY_POINTER_BYTES);
    const after = fs.fstatSync(descriptor, { bigint: true });
    const linked = fs.lstatSync(manifestPath, { bigint: true });
    if (
      after.nlink !== 1n ||
      linked.nlink !== 1n ||
      !sameFileMetadata(before, after) ||
      !sameFileMetadata(after, linked)
    )
      throw new Error("managed project directory manifest changed during inspection");
    manifestStat = after;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }

  const observedBundle = fs.lstatSync(bundlePath, { bigint: true });
  if (
    observedBundle.isSymbolicLink() ||
    !observedBundle.isDirectory() ||
    !sameComponentMetadata(bundleStat, observedBundle)
  )
    throw new Error("managed project directory target changed during manifest inspection");

  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("managed project directory manifest is invalid JSON");
  }
  const expectedKeys = [
    "bundle_dev",
    "bundle_ino",
    "canonical_basename_sha256",
    "commit_file",
    "files",
    "kind",
    "nonce",
    "schema_version",
    "target_basename",
  ];
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== expectedKeys.sort().join(",") ||
    value.schema_version !== 1 ||
    value.kind !== "pm-managed-directory-bundle" ||
    !/^[a-f0-9]{48}$/.test(value.nonce || "") ||
    value.target_basename !== targetBasename ||
    value.target_basename !== managedDirectoryBundleName(canonicalBasename, value.nonce) ||
    value.canonical_basename_sha256 !==
      crypto.createHash("sha256").update(canonicalBasename).digest("hex") ||
    value.bundle_dev !== bundleStat.dev.toString() ||
    value.bundle_ino !== bundleStat.ino.toString() ||
    !isPortableManagedFileName(value.commit_file) ||
    !Array.isArray(value.files) ||
    value.files.length < 1 ||
    value.files.length > MAX_MANAGED_DIRECTORY_FILES
  )
    throw new Error("managed project directory manifest shape or binding is invalid");

  const files = new Map();
  let previousName = null;
  let totalPayloadBytes = 0;
  for (const file of value.files) {
    if (
      !file ||
      typeof file !== "object" ||
      Array.isArray(file) ||
      Object.keys(file).sort().join(",") !== "name,sha256,size" ||
      !isPortableManagedFileName(file.name) ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      !/^sha256:[a-f0-9]{64}$/.test(file.sha256 || "") ||
      (previousName !== null && previousName >= file.name)
    )
      throw new Error("managed project directory file inventory is invalid");
    totalPayloadBytes += file.size;
    if (
      !Number.isSafeInteger(totalPayloadBytes) ||
      totalPayloadBytes > MAX_MANAGED_DIRECTORY_PAYLOAD_BYTES
    )
      throw new Error("managed project directory payload inventory exceeds its safety budget");
    previousName = file.name;
    files.set(file.name, file);
  }
  if (!files.has(value.commit_file))
    throw new Error("managed project directory commit marker is absent from its inventory");

  const entries = fs.readdirSync(bundlePath).sort();
  const expectedEntries = [MANAGED_DIRECTORY_POINTER_FILE, ...files.keys()].sort();
  if (
    entries.length !== expectedEntries.length ||
    entries.some((entry, index) => entry !== expectedEntries[index])
  )
    throw new Error("managed project directory entries differ from its immutable inventory");
  const entryComponents = [];
  for (const entry of entries) {
    const entryPath = path.join(bundlePath, entry);
    const stat = fs.lstatSync(entryPath, { bigint: true });
    if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1n)
      throw new Error("managed project directory contains a non-regular entry");
    if (entry !== MANAGED_DIRECTORY_POINTER_FILE) {
      const expected = files.get(entry);
      if (stat.size !== BigInt(expected.size))
        throw new Error(`managed project directory file size changed: ${entry}`);
      if (verifyPayloadHashes) {
        const verified = readManagedBundleEntry(entryPath, stat, expected);
        entryComponents.push({ path: entryPath, kind: "bundle-entry", stat: verified });
      } else entryComponents.push({ path: entryPath, kind: "bundle-entry", stat });
    } else {
      if (!sameFileMetadata(stat, manifestStat))
        throw new Error("managed project directory manifest changed after validation");
      entryComponents.push({ path: entryPath, kind: "bundle-entry", stat });
    }
  }
  return {
    files,
    commitFile: value.commit_file,
    manifestSha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    manifestStat,
    entryComponents,
  };
}

function readManagedBundleEntry(entryPath, expectedStat, expected) {
  let descriptor;
  try {
    descriptor = fs.openSync(
      entryPath,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0)
    );
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || opened.nlink !== 1n || !sameFileMetadata(expectedStat, opened))
      throw new Error(`managed project directory file changed: ${expected.name}`);
    const digest = crypto.createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let total = 0;
    while (total < expected.size) {
      const requested = Math.min(buffer.length, expected.size - total);
      const count = fs.readSync(descriptor, buffer, 0, requested, null);
      if (count === 0)
        throw new Error(`managed project directory file was truncated: ${expected.name}`);
      digest.update(buffer.subarray(0, count));
      total += count;
    }
    if (fs.readSync(descriptor, buffer, 0, 1, null) !== 0)
      throw new Error(`managed project directory file grew: ${expected.name}`);
    const after = fs.fstatSync(descriptor, { bigint: true });
    const linked = fs.lstatSync(entryPath, { bigint: true });
    const observedDigest = `sha256:${digest.digest("hex")}`;
    if (
      total !== expected.size ||
      observedDigest !== expected.sha256 ||
      after.nlink !== 1n ||
      linked.nlink !== 1n ||
      linked.isSymbolicLink() ||
      !linked.isFile() ||
      !sameFileMetadata(opened, after) ||
      !sameFileMetadata(after, linked)
    )
      throw new Error(
        `managed project directory file differs from its inventory: ${expected.name}`
      );
    return after;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function snapshotProjectPath(projectRoot, relation, absolute, options = {}) {
  const parts = relation.split(path.sep);
  const logicalComponents = [];
  const physicalComponents = [];
  const rootStat = fs.lstatSync(projectRoot, { bigint: true });
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory())
    throw new Error(`project root is not a real directory: ${projectRoot}`);
  logicalComponents.push({ path: projectRoot, kind: "root", stat: rootStat });

  let current = projectRoot;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    current = path.join(current, part);
    const stat = fs.lstatSync(current, { bigint: true });
    const final = index === parts.length - 1;
    if (!stat.isSymbolicLink()) {
      if (!final && !stat.isDirectory())
        throw new Error(`project path ancestor is not a directory: ${current}`);
      logicalComponents.push({ path: current, kind: final ? "leaf" : "ancestor", stat });
      continue;
    }

    if (options.allowManagedDirectoryPointers !== true || final || index !== parts.length - 2)
      throw new Error(`project path contains symlink: ${current}`);
    const pointerBefore = stat;
    const targetText = fs.readlinkSync(current);
    const pointerAfter = fs.lstatSync(current, { bigint: true });
    if (
      !pointerAfter.isSymbolicLink() ||
      pointerAfter.nlink !== 1n ||
      !sameComponentMetadata(pointerBefore, pointerAfter)
    )
      throw new Error("managed project directory pointer changed during inspection");
    if (
      path.isAbsolute(targetText) ||
      targetText.includes("/") ||
      targetText.includes("\\") ||
      targetText === "." ||
      targetText === ".."
    )
      throw new Error(
        `project path contains symlink: unrecognized or escaping pointer at ${current}`
      );
    const match = targetText.match(/^\.pm-dir-bundle-([a-f0-9]{32})-([a-f0-9]{48})$/);
    const expectedHash = crypto.createHash("sha256").update(part).digest("hex");
    if (!match || match[1] !== expectedHash.slice(0, 32))
      throw new Error(`project path contains symlink: unrecognized managed pointer at ${current}`);

    logicalComponents.push({ path: current, kind: "managed-pointer", stat: pointerAfter });
    const bundlePath = path.join(path.dirname(current), targetText);
    const bundleStat = fs.lstatSync(bundlePath, { bigint: true });
    if (bundleStat.isSymbolicLink() || !bundleStat.isDirectory())
      throw new Error("managed project directory target is not a real directory");
    physicalComponents.push({ path: bundlePath, kind: "managed-bundle", stat: bundleStat });
    const manifest = readManagedDirectoryManifest(
      bundlePath,
      bundleStat,
      part,
      targetText,
      options.verifyManagedPayloadHashes !== false
    );
    physicalComponents.push(...manifest.entryComponents);

    const leafName = parts[index + 1];
    const requestedFile = manifest.files.get(leafName);
    if (!requestedFile)
      throw new Error("managed project directory input is absent from its immutable inventory");
    const physicalAbsolute = path.join(bundlePath, leafName);
    const leafStat = fs.lstatSync(physicalAbsolute, { bigint: true });
    if (leafStat.isSymbolicLink() || !leafStat.isFile())
      throw new Error("managed project directory input is not a regular file");
    if (leafStat.size !== BigInt(requestedFile.size))
      throw new Error("managed project directory input size changed");
    const inventoriedLeaf = manifest.entryComponents.find(
      (component) => component.path === physicalAbsolute
    )?.stat;
    if (!inventoriedLeaf || !sameFileMetadata(inventoriedLeaf, leafStat))
      throw new Error("managed project directory input changed after inventory validation");
    const finalPointer = fs.lstatSync(current, { bigint: true });
    const finalBundle = fs.lstatSync(bundlePath, { bigint: true });
    if (
      !finalPointer.isSymbolicLink() ||
      finalPointer.nlink !== 1n ||
      !sameComponentMetadata(pointerAfter, finalPointer) ||
      fs.readlinkSync(current) !== targetText ||
      finalBundle.isSymbolicLink() ||
      !finalBundle.isDirectory() ||
      !sameComponentMetadata(bundleStat, finalBundle)
    )
      throw new Error("managed project directory pointer or target changed during inspection");

    return {
      absolute,
      physicalAbsolute,
      logicalComponents,
      physicalComponents,
      finalStat: leafStat,
      managed: {
        targetText,
        manifestSha256: manifest.manifestSha256,
        requestedFile,
        commitFile: manifest.commitFile,
        files: [...manifest.files.values()],
      },
    };
  }

  return {
    absolute,
    physicalAbsolute: absolute,
    logicalComponents,
    physicalComponents,
    finalStat: logicalComponents.at(-1)?.stat,
    managed: null,
  };
}

function inspectStableProjectInput(
  root,
  relativePath,
  maxBytes = Number.MAX_SAFE_INTEGER,
  options = {}
) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
    throw new Error("input byte budget must be a non-negative safe integer");
  const location = projectPath(root, relativePath);
  return retryAncestorEntryChurn((baseline) =>
    inspectStableProjectInputOnce(location, maxBytes, options, baseline)
  );
}

function inspectStableProjectInputOnce(
  { absolute, projectRoot, relation },
  maxBytes,
  options,
  baseline
) {
  const initial = snapshotProjectPath(projectRoot, relation, absolute, {
    allowManagedDirectoryPointers: options.allowManagedDirectoryPointers === true,
  });
  assertRetryBaseline(baseline, initial, "input path changed during containment validation");
  if (!initial.finalStat?.isFile()) throw new Error("input must be an existing regular file");
  if (initial.finalStat.size > BigInt(maxBytes))
    throw new Error(`input exceeds ${maxBytes}-byte budget`);
  const observed = snapshotProjectPath(projectRoot, relation, absolute, {
    allowManagedDirectoryPointers: options.allowManagedDirectoryPointers === true,
    verifyManagedPayloadHashes: false,
  });
  assertStableSnapshot(initial, observed, "input path changed during containment validation");
  return {
    path: absolute,
    relative: relation.split(path.sep).join("/"),
    size: Number(initial.finalStat.size),
    stablePathIdentity: stablePathIdentity(initial),
  };
}

function readProjectInput(root, relativePath, maxBytes = Number.MAX_SAFE_INTEGER, options = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
    throw new Error("input byte budget must be a non-negative safe integer");
  const location = projectPath(root, relativePath);
  return retryAncestorEntryChurn((baseline) =>
    readProjectInputOnce(location, maxBytes, options, baseline)
  );
}

function readProjectInputOnce({ absolute, projectRoot, relation }, maxBytes, options, baseline) {
  const requireStablePath = options.requireStablePath === true;
  const initial = snapshotProjectPath(projectRoot, relation, absolute, {
    allowManagedDirectoryPointers: options.allowManagedDirectoryPointers === true,
  });
  assertRetryBaseline(baseline, initial, "input changed during containment validation");
  if (!initial.finalStat?.isFile()) throw new Error("input must be an existing regular file");
  if (initial.finalStat.size > BigInt(maxBytes))
    throw new Error(`input exceeds ${maxBytes}-byte budget`);

  const flags =
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0);
  let descriptor;
  try {
    descriptor = fs.openSync(initial.physicalAbsolute, flags);
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (!opened.isFile()) throw new Error("input must be an existing regular file");
    if (opened.size > BigInt(maxBytes)) throw new Error(`input exceeds ${maxBytes}-byte budget`);
    if (!sameFileMetadata(initial.finalStat, opened))
      throw new Error("input changed during containment validation");

    const observed = snapshotProjectPath(projectRoot, relation, absolute, {
      allowManagedDirectoryPointers: options.allowManagedDirectoryPointers === true,
      verifyManagedPayloadHashes: false,
    });
    if (!sameFileMetadata(opened, observed.finalStat))
      throw new Error("input changed during containment validation");
    assertStableSnapshot(initial, observed, "input changed during containment validation");

    const bytes = readDescriptorBounded(descriptor, maxBytes);
    if (initial.managed) {
      const observedHash = `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
      if (
        bytes.length !== initial.managed.requestedFile.size ||
        observedHash !== initial.managed.requestedFile.sha256
      )
        throw new Error("managed project directory input differs from its immutable inventory");
    }

    if (requireStablePath || initial.managed) {
      const after = fs.fstatSync(descriptor, { bigint: true });
      if (!sameFileMetadata(opened, after)) throw new Error("input changed during bounded read");
      const final = snapshotProjectPath(projectRoot, relation, absolute, {
        allowManagedDirectoryPointers: options.allowManagedDirectoryPointers === true,
        verifyManagedPayloadHashes: false,
      });
      if (!sameFileMetadata(after, final.finalStat))
        throw new Error("input path changed during bounded read");
      assertStableSnapshot(initial, final, "input path changed during bounded read");
    }
    return {
      path: absolute,
      relative: relation.split(path.sep).join("/"),
      bytes,
      ...(initial.managed
        ? {
            managedDirectory: {
              target: initial.managed.targetText,
              commitFile: initial.managed.commitFile,
              files: initial.managed.files,
            },
          }
        : {}),
      ...(requireStablePath ? { stablePathIdentity: stablePathIdentity(initial) } : {}),
    };
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

module.exports = { inspectStableProjectInput, readProjectInput };
