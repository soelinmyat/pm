"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  EVENT_KINDS,
  MAX_BYTES,
  beginSegment,
  compactLedger,
  finishSegment,
  readLedger,
  recoverInterruptedSegments,
} = require("../scripts/delivery-telemetry");
const { withDeliveryTelemetry } = require("../scripts/release-transaction");

function temporaryLedger(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-delivery-telemetry-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return path.join(root, "delivery-timing.json");
}

test("records only bounded delivery timing categories with monotonic durations", (t) => {
  const ledgerPath = temporaryLedger(t);
  let monotonic = 1_000_000_000n;
  const clock = {
    monotonic: () => monotonic,
    wall: () => new Date("2026-08-10T00:00:00.000Z"),
  };
  for (const kind of EVENT_KINDS) {
    const segment = beginSegment(
      ledgerPath,
      {
        kind,
        app: "mobile",
        route: "comprehensive",
        artifact_identity: "sha256:" + "a".repeat(64),
      },
      { clock }
    );
    monotonic += 2_500_000n;
    finishSegment(ledgerPath, segment, { outcome: "passed", certification_count: 1 }, { clock });
  }

  const ledger = readLedger(ledgerPath);
  assert.deepEqual(
    ledger.events.map((event) => event.kind),
    EVENT_KINDS
  );
  assert.ok(ledger.events.every((event) => event.duration_ms === 2.5));
  assert.equal(fs.lstatSync(ledgerPath).mode & 0o777, 0o600);
  assert.ok(fs.statSync(ledgerPath).size <= 1024 * 1024);
  assert.doesNotMatch(
    JSON.stringify(ledger),
    /command_output|prompt|credential|connection_identity/
  );
});

test("rejects sensitive or unbounded telemetry fields", (t) => {
  const ledgerPath = temporaryLedger(t);
  assert.throws(
    () => beginSegment(ledgerPath, { kind: "active-command", command_output: "secret" }),
    /unsupported telemetry field/
  );
  assert.throws(
    () => beginSegment(ledgerPath, { kind: "active-command", app: "x".repeat(129) }),
    /bounded identifier/
  );
});

test("restart recovery closes abandoned segments without deriving duration from wall time", (t) => {
  const ledgerPath = temporaryLedger(t);
  const started = beginSegment(
    ledgerPath,
    { kind: "review-wait", app: "api", route: "optimized" },
    {
      processId: "process-a",
      clock: { monotonic: () => 10n, wall: () => new Date("2026-08-10T00:00:00Z") },
    }
  );
  assert.ok(started.token);
  recoverInterruptedSegments(ledgerPath, {
    processId: "process-b",
    wall: () => new Date("2036-08-10T00:00:00Z"),
  });
  const ledger = readLedger(ledgerPath);
  assert.equal(ledger.open_segments.length, 0);
  assert.equal(ledger.events[0].outcome, "interrupted");
  assert.equal(ledger.events[0].duration_ms, null);
});

test("deterministically compacts to 512 events and one MiB", () => {
  const events = Array.from({ length: 700 }, (_, index) => ({
    sequence: index + 1,
    kind: "active-command",
    app: "mobile",
    route: "optimized",
    artifact_identity: null,
    delivery_id: null,
    started_at: "2026-08-10T00:00:00.000Z",
    ended_at: "2026-08-10T00:00:00.001Z",
    duration_ms: 1,
    outcome: "passed",
    certification_count: 0,
  }));
  const template = {
    schema_version: 1,
    kind: "delivery-timing-ledger-v1",
    events,
    open_segments: [],
    compaction: { dropped_events: 0, duration_ms: 0, certification_count: 0 },
  };
  const left = structuredClone(template);
  const right = structuredClone(template);
  compactLedger(left);
  compactLedger(right);
  assert.equal(left.events.length, 512);
  assert.deepEqual(left.compaction, right.compaction);
  assert.deepEqual(left.events, right.events);
  assert.ok(Buffer.byteLength(JSON.stringify(left)) <= MAX_BYTES);
});

test("release transaction operations record real final-certification boundaries", (t) => {
  const transactionPath = path.join(path.dirname(temporaryLedger(t)), "release-transaction.json");
  const result = withDeliveryTelemetry(
    transactionPath,
    { kind: "final-certification", route: "optimized", delivery_id: "run-1" },
    () => ({ decision: "certified" })
  );
  assert.equal(result.decision, "certified");
  const ledger = readLedger(path.join(path.dirname(transactionPath), "delivery-timing.json"));
  assert.equal(ledger.events.length, 1);
  assert.equal(ledger.events[0].kind, "final-certification");
  assert.equal(ledger.events[0].certification_count, 1);
});
