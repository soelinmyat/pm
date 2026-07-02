"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  buildLease,
  isLeaseExpired,
  leaseFileName,
  prepareLease,
  sanitizeId,
} = require("../scripts/loop-git.js");

const CONFIG = {
  default_runtime: "codex",
  budgets: {
    lease_ttl_minutes: 45,
  },
};

function makePmDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-loop-git-"));
  const pmDir = path.join(root, "pm");
  fs.mkdirSync(pmDir, { recursive: true });
  return {
    pmDir,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

test("loop lease helpers sanitize ids and build stable filenames", () => {
  assert.equal(sanitizeId(" PM-001 / Dev "), "pm-001-dev");
  assert.equal(leaseFileName("PM-001", "dev"), "dev-pm-001.json");
});

test("buildLease sets holder, runtime, and ttl", () => {
  const lease = buildLease(
    {
      cardId: "PM-001",
      stage: "dev",
      holder: "machine-a",
      sourcePath: "pm/backlog/a.md",
    },
    CONFIG,
    { now: new Date("2026-06-23T00:00:00Z") }
  );

  assert.equal(lease.card_id, "PM-001");
  assert.equal(lease.stage, "dev");
  assert.equal(lease.holder, "machine-a");
  assert.equal(lease.runtime, "codex");
  assert.equal(lease.claimed_at, "2026-06-23T00:00:00.000Z");
  assert.equal(lease.expires_at, "2026-06-23T00:45:00.000Z");
});

test("prepareLease writes one active lease and blocks duplicate claims", (t) => {
  const { pmDir, cleanup } = makePmDir();
  t.after(cleanup);

  const first = prepareLease(
    pmDir,
    { cardId: "PM-001", stage: "dev", holder: "machine-a" },
    CONFIG,
    { now: new Date("2026-06-23T00:00:00Z") }
  );
  assert.equal(first.ok, true);
  assert.equal(fs.existsSync(first.filePath), true);

  const second = prepareLease(
    pmDir,
    { cardId: "PM-001", stage: "dev", holder: "machine-b" },
    CONFIG,
    { now: new Date("2026-06-23T00:10:00Z") }
  );
  assert.equal(second.ok, false);
  assert.equal(second.reason, "active-lease");
  assert.equal(second.lease.holder, "machine-a");
});

test("prepareLease blocks a second active lease for the same card across stages", (t) => {
  const { pmDir, cleanup } = makePmDir();
  t.after(cleanup);

  const first = prepareLease(
    pmDir,
    { cardId: "PM-001", stage: "dev", holder: "machine-a" },
    CONFIG,
    { now: new Date("2026-06-23T00:00:00Z") }
  );
  assert.equal(first.ok, true);

  const second = prepareLease(
    pmDir,
    { cardId: "PM-001", stage: "review", holder: "machine-b" },
    CONFIG,
    { now: new Date("2026-06-23T00:10:00Z") }
  );
  assert.equal(second.ok, false);
  assert.equal(second.reason, "active-lease");
  assert.equal(second.lease.stage, "dev");
});

test("expired leases are not considered active", () => {
  assert.equal(
    isLeaseExpired(
      {
        expires_at: "2026-06-23T00:00:00Z",
      },
      new Date("2026-06-23T00:00:01Z")
    ),
    true
  );
  assert.equal(
    isLeaseExpired(
      {
        expires_at: "2026-06-23T00:00:02Z",
      },
      new Date("2026-06-23T00:00:01Z")
    ),
    false
  );
});
