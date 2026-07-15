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
