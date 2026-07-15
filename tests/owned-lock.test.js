"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { acquireOwnedLock } = require("../scripts/lib/owned-lock.js");

test("abandoned-lock reclamation never exposes an unlocked replacement window", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-owned-lock-aba-"));
  const lockPath = path.join(root, "capture.lock");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(
    lockPath,
    JSON.stringify({
      pid: 2147483647,
      token: "abandoned-owner",
      created_at: new Date(0).toISOString(),
    })
  );

  let contenderAcquired = false;
  let contenderRelease = null;
  const release = acquireOwnedLock(lockPath, {
    attempts: 2,
    waitMs: 0,
    invalidGraceMs: 0,
    afterReclaimSnapshot() {
      // Simulate a second reclaimer removing the same stale inode after this
      // contender's final identity check, then publishing its replacement.
      fs.unlinkSync(lockPath);
      try {
        contenderRelease = acquireOwnedLock(lockPath, {
          attempts: 1,
          waitMs: 0,
          reclaimAbandoned: false,
        });
        contenderAcquired = true;
      } catch (error) {
        assert.match(error.message, /timed out waiting/);
      }
    },
  });
  t.after(() => contenderRelease?.());
  t.after(release);

  assert.equal(contenderAcquired, false);
});

test("invalid-directory reclamation never exposes an unlocked replacement window", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-owned-lock-directory-aba-"));
  const lockPath = path.join(root, "capture.lock");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(lockPath);

  let contenderAcquired = false;
  let contenderRelease = null;
  const release = acquireOwnedLock(lockPath, {
    attempts: 2,
    waitMs: 0,
    invalidGraceMs: 0,
    afterReclaimSnapshot() {
      try {
        contenderRelease = acquireOwnedLock(lockPath, {
          attempts: 1,
          waitMs: 0,
          reclaimAbandoned: false,
        });
        contenderAcquired = true;
      } catch (error) {
        assert.match(error.message, /timed out waiting/);
      }
    },
  });
  t.after(() => contenderRelease?.());
  t.after(release);

  assert.equal(contenderAcquired, false);
});

test("an abandoned recovery guard advances safely to a successor generation", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-owned-lock-recovery-guard-"));
  const lockPath = path.join(root, "capture.lock");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(
    lockPath,
    JSON.stringify({
      pid: 2147483647,
      token: "abandoned-lock-owner",
      created_at: new Date(0).toISOString(),
    })
  );
  fs.writeFileSync(
    `${lockPath}.reclaim`,
    JSON.stringify({
      pid: 2147483647,
      token: "abandoned-recovery-owner",
      created_at: new Date(0).toISOString(),
    })
  );

  let contenderAcquired = false;
  let contenderRelease = null;
  const release = acquireOwnedLock(lockPath, {
    attempts: 3,
    waitMs: 0,
    invalidGraceMs: 0,
    afterReclaimSnapshot() {
      try {
        contenderRelease = acquireOwnedLock(lockPath, {
          attempts: 1,
          waitMs: 0,
          reclaimAbandoned: false,
        });
        contenderAcquired = true;
      } catch (error) {
        assert.match(error.message, /timed out waiting/);
      }
    },
  });
  t.after(() => contenderRelease?.());
  t.after(release);

  assert.equal(contenderAcquired, false);
  assert.equal(JSON.parse(fs.readFileSync(lockPath, "utf8")).pid, process.pid);
});

test("a live recovery guard still excludes a new owner", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-owned-lock-live-recovery-guard-"));
  const lockPath = path.join(root, "capture.lock");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(
    `${lockPath}.reclaim`,
    JSON.stringify({
      pid: process.pid,
      token: "live-recovery-owner",
      created_at: new Date().toISOString(),
    })
  );

  assert.throws(() => acquireOwnedLock(lockPath, { attempts: 1, waitMs: 0 }), /timed out waiting/);
  assert.equal(fs.existsSync(lockPath), false);
});
