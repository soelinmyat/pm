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
      if (reclaimAbandonedLock(lockPath, options)) continue;
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
  try {
    fs.renameSync(lockPath, quarantine);
  } catch {
    return false;
  }
  try {
    const moved = readLockOwner(quarantine);
    if (!observed.token || moved.token !== observed.token) {
      try {
        fs.renameSync(quarantine, lockPath);
      } catch {
        // A newer owner already occupies the fixed path.
      }
      return false;
    }
  } catch {
    if (observed.token) return false;
  }
  fs.rmSync(quarantine, { recursive: true, force: true });
  return true;
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
