"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const { writeJsonAtomic } = require("./atomic-file");

function acquireOwnedLock(lockPath, options = {}) {
  const attempts = options.attempts ?? 2;
  const waitMs = options.waitMs ?? 0;
  const recoveryPath = `${lockPath}.reclaim`;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (recoveryGuardState(recoveryPath).active) {
      synchronousWait(waitMs);
      continue;
    }

    const token = crypto.randomBytes(16).toString("hex");
    const candidatePath = `${lockPath}.candidate-${process.pid}-${token}`;
    try {
      writeLockCandidate(candidatePath, token, options);
      fs.linkSync(candidatePath, lockPath);
      fs.rmSync(candidatePath, { force: true });

      // A reclaimer can publish its guard after the check above but before this
      // link. Do not enter the critical section while reclamation is active.
      if (recoveryGuardState(recoveryPath).active) {
        releaseOwnedLock(lockPath, token);
        synchronousWait(waitMs);
        continue;
      }

      const release = () => releaseOwnedLock(lockPath, token);
      release.cached = null;
      return release;
    } catch (error) {
      fs.rmSync(candidatePath, { force: true });
      if (error.code !== "EEXIST") throw error;
      const cached = options.readCached?.();
      if (cached) {
        const release = () => {};
        release.cached = cached;
        return release;
      }
      if (options.reclaimAbandoned !== false && reclaimAbandonedLock(lockPath, options)) continue;
      synchronousWait(waitMs);
    }
  }
  throw new Error(options.timeoutMessage || `timed out waiting for owned lock: ${lockPath}`);
}

function writeLockCandidate(candidatePath, token, options) {
  writeJsonAtomic(
    candidatePath,
    { pid: process.pid, token, created_at: new Date().toISOString() },
    { directoryMode: options.directoryMode ?? 0o700, fileMode: options.fileMode ?? 0o600 }
  );
}

function tryAcquireRecoveryGuard(recoveryPath, options) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const state = recoveryGuardState(recoveryPath);
    if (state.active) return null;
    const release = tryPublishRecoveryGuard(state.vacantPath, options);
    if (release) return release;
  }
  return null;
}

function tryPublishRecoveryGuard(guardPath, options) {
  const token = crypto.randomBytes(16).toString("hex");
  const candidatePath = `${guardPath}.candidate-${process.pid}-${token}`;
  try {
    writeLockCandidate(candidatePath, token, options);
    fs.linkSync(candidatePath, guardPath);
    fs.rmSync(candidatePath, { force: true });
    return () => releaseOwnedLock(guardPath, token);
  } catch (error) {
    fs.rmSync(candidatePath, { force: true });
    if (error.code === "EEXIST") return null;
    throw error;
  }
}

function recoveryGuardState(recoveryPath) {
  let currentPath = recoveryPath;
  for (let depth = 0; depth < 32; depth += 1) {
    let owner;
    try {
      owner = readLockOwner(currentPath);
    } catch {
      if (!pathExists(currentPath)) return { active: false, vacantPath: currentPath };
      return { active: true, vacantPath: null };
    }

    if (ownerIsAlive(owner)) return { active: true, vacantPath: null };
    currentPath = recoverySuccessorPath(recoveryPath, owner.token);
  }
  return { active: true, vacantPath: null };
}

function recoverySuccessorPath(recoveryPath, parentToken) {
  const generation = crypto
    .createHash("sha256")
    .update(`${recoveryPath}\0${parentToken}`)
    .digest("hex")
    .slice(0, 32);
  return `${recoveryPath}.next-${generation}`;
}

function ownerIsAlive(owner) {
  try {
    process.kill(owner.pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

function releaseOwnedLock(lockPath, token) {
  try {
    if (readLockOwner(lockPath).token === token) fs.rmSync(lockPath, { force: true });
  } catch {
    // The lock was already reclaimed or released.
  }
}

function reclaimAbandonedLock(lockPath, options = {}) {
  const initial = inspectAbandonedLock(lockPath, options.invalidGraceMs ?? 1000);
  if (!initial) return false;

  options.beforeReclaimRename?.({
    lockPath,
    observed: structuredClone(initial.owner || { token: null }),
  });

  const recoveryPath = `${lockPath}.reclaim`;
  const releaseRecovery = tryAcquireRecoveryGuard(recoveryPath, options);
  if (!releaseRecovery) return false;

  try {
    const current = inspectAbandonedLock(lockPath, options.invalidGraceMs ?? 1000);
    if (!sameObservedLock(initial, current)) return false;

    options.afterReclaimSnapshot?.({
      lockPath,
      recoveryPath,
      observed: structuredClone(initial.owner || { token: null }),
    });

    // Test hooks and external actors may have changed the pathname. Missing is
    // already reclaimed; a different inode belongs to a new owner and must stay.
    let finalStat;
    try {
      finalStat = fs.lstatSync(lockPath);
    } catch (error) {
      return error.code === "ENOENT";
    }
    if (!sameInode(initial.stat, finalStat)) return false;

    if (initial.kind === "directory") {
      fs.rmSync(lockPath, { recursive: true });
    } else {
      fs.unlinkSync(lockPath);
    }
    return true;
  } finally {
    releaseRecovery();
  }
}

function inspectAbandonedLock(lockPath, invalidGraceMs) {
  let stat;
  try {
    stat = fs.lstatSync(lockPath);
  } catch {
    return null;
  }

  try {
    const owner = readLockOwner(lockPath);
    try {
      process.kill(owner.pid, 0);
      return null;
    } catch (error) {
      if (error.code !== "ESRCH") return null;
    }
    return { kind: "owned-file", owner, stat };
  } catch {
    if (Date.now() - stat.mtimeMs < invalidGraceMs) return null;
    return { kind: stat.isDirectory() ? "directory" : "invalid-file", owner: null, stat };
  }
}

function sameObservedLock(initial, current) {
  if (!current || initial.kind !== current.kind || !sameInode(initial.stat, current.stat)) {
    return false;
  }
  if (initial.owner) return current.owner?.token === initial.owner.token;
  return current.owner === null;
}

function sameInode(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function pathExists(targetPath) {
  try {
    fs.lstatSync(targetPath);
    return true;
  } catch (error) {
    return error.code !== "ENOENT";
  }
}

function readLockOwner(lockPath) {
  const owner = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  if (
    !Number.isInteger(owner.pid) ||
    owner.pid < 1 ||
    typeof owner.token !== "string" ||
    !owner.token
  ) {
    throw new Error("invalid lock owner");
  }
  return owner;
}

function synchronousWait(ms) {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

module.exports = { acquireOwnedLock, readLockOwner };
