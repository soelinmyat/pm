"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const { writeJsonAtomic } = require("./atomic-file");

function acquireOwnedLock(lockPath, options = {}) {
  const attempts = options.attempts ?? 2;
  const waitMs = options.waitMs ?? 0;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const token = crypto.randomBytes(16).toString("hex");
    const candidatePath = `${lockPath}.candidate-${process.pid}-${token}`;
    try {
      writeJsonAtomic(
        candidatePath,
        { pid: process.pid, token, created_at: new Date().toISOString() },
        { directoryMode: options.directoryMode ?? 0o700, fileMode: options.fileMode ?? 0o600 }
      );
      fs.linkSync(candidatePath, lockPath);
      fs.rmSync(candidatePath, { force: true });
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

function releaseOwnedLock(lockPath, token) {
  try {
    if (readLockOwner(lockPath).token === token) fs.rmSync(lockPath, { force: true });
  } catch {
    // The lock was already reclaimed or released.
  }
}

function reclaimAbandonedLock(lockPath, options = {}) {
  const invalidGraceMs = options.invalidGraceMs ?? 1000;
  let observed;
  try {
    observed = readLockOwner(lockPath);
    try {
      process.kill(observed.pid, 0);
      return false;
    } catch (error) {
      if (error.code !== "ESRCH") return false;
    }
  } catch {
    try {
      if (Date.now() - fs.statSync(lockPath).mtimeMs < invalidGraceMs) return false;
      observed = { token: null };
    } catch {
      return false;
    }
  }
  options.beforeReclaimRename?.({ lockPath, observed: structuredClone(observed) });
  const quarantine = `${lockPath}.stale-${process.pid}-${crypto.randomBytes(8).toString("hex")}`;
  let snapshotKind = "hard-link";
  try {
    fs.linkSync(lockPath, quarantine);
  } catch {
    // A malformed directory cannot be hard-linked. Preserve the legacy recovery
    // path only for that invalid shape; every valid owned lock uses the
    // descriptor-stable hard-link path below.
    let stat;
    try {
      stat = fs.lstatSync(lockPath);
    } catch {
      return false;
    }
    if (observed.token || !stat.isDirectory()) return false;
    try {
      fs.renameSync(lockPath, quarantine);
      snapshotKind = "moved-directory";
    } catch {
      return false;
    }
  }
  try {
    options.afterReclaimSnapshot?.({ lockPath, quarantine, observed: structuredClone(observed) });
    if (snapshotKind === "hard-link") {
      let snapshotOwner = null;
      try {
        snapshotOwner = readLockOwner(quarantine);
      } catch {
        // An invalid regular-file owner is reclaimable after the grace period.
      }
      if (
        (observed.token && snapshotOwner?.token !== observed.token) ||
        (!observed.token && snapshotOwner)
      ) {
        return false;
      }
      let fixed;
      let snapshot;
      try {
        fixed = fs.lstatSync(lockPath);
        snapshot = fs.lstatSync(quarantine);
      } catch {
        return false;
      }
      if (fixed.dev !== snapshot.dev || fixed.ino !== snapshot.ino) return false;
      fs.unlinkSync(lockPath);
    } else if (!fs.lstatSync(quarantine).isDirectory()) {
      return false;
    }
    return true;
  } finally {
    fs.rmSync(quarantine, { recursive: true, force: true });
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
