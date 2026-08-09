#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { writeJsonAtomic } = require("./lib/atomic-file");
const { acquireOwnedLock } = require("./lib/owned-lock");

const EVENT_KINDS = Object.freeze([
  "environment-preflight",
  "active-command",
  "review-wait",
  "ci-queue",
  "ci-run",
  "merge-wait",
  "invalidation",
  "reuse",
  "final-certification",
]);
const OUTCOMES = new Set(["passed", "failed", "blocked", "skipped", "interrupted"]);
const BEGIN_FIELDS = new Set(["kind", "app", "route", "artifact_identity", "delivery_id"]);
const FINISH_FIELDS = new Set(["outcome", "certification_count"]);
const MAX_EVENTS = 512;
const MAX_OPEN_SEGMENTS = 64;
const MAX_BYTES = 1024 * 1024;
const PROCESS_ID = `${process.pid}-${crypto.randomBytes(16).toString("hex")}`;

function emptyLedger() {
  return {
    schema_version: 1,
    kind: "delivery-timing-ledger-v1",
    events: [],
    open_segments: [],
    compaction: {
      dropped_events: 0,
      duration_ms: 0,
      certification_count: 0,
    },
  };
}

function readLedger(filePath) {
  if (!fs.existsSync(filePath)) return emptyLedger();
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES)
    throw new Error("delivery telemetry ledger must be a bounded regular file");
  const ledger = JSON.parse(fs.readFileSync(filePath, "utf8"));
  validateLedger(ledger);
  return ledger;
}

function validateLedger(ledger) {
  if (
    ledger?.schema_version !== 1 ||
    ledger.kind !== "delivery-timing-ledger-v1" ||
    !Array.isArray(ledger.events) ||
    !Array.isArray(ledger.open_segments) ||
    ledger.events.length > MAX_EVENTS ||
    ledger.open_segments.length > MAX_OPEN_SEGMENTS
  )
    throw new Error("invalid delivery telemetry ledger");
}

function validateFields(value, allowed) {
  for (const field of Object.keys(value || {}))
    if (!allowed.has(field)) throw new Error(`unsupported telemetry field: ${field}`);
}

function boundedIdentifier(value, field, required = false) {
  if (value === undefined && !required) return null;
  if (typeof value !== "string" || !value || value.length > 128 || /[\0\r\n]/.test(value))
    throw new Error(`${field} must be a bounded identifier`);
  return value;
}

function clockFrom(options = {}) {
  const source = options.clock || {};
  return {
    monotonic: source.monotonic || (() => process.hrtime.bigint()),
    wall: source.wall || (() => new Date()),
  };
}

function mutateLedger(filePath, mutate) {
  const absolute = path.resolve(filePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true, mode: 0o700 });
  const release = acquireOwnedLock(`${absolute}.lock`, {
    attempts: 20,
    waitMs: 5,
    directoryMode: 0o700,
    fileMode: 0o600,
    timeoutMessage: "timed out waiting for delivery telemetry ledger",
  });
  try {
    const ledger = readLedger(absolute);
    const result = mutate(ledger);
    compactLedger(ledger);
    writeJsonAtomic(absolute, ledger, { directoryMode: 0o700, fileMode: 0o600 });
    if (fs.statSync(absolute).size > MAX_BYTES)
      throw new Error("delivery telemetry ledger exceeds one MiB");
    return result;
  } finally {
    release();
  }
}

function beginSegment(filePath, input, options = {}) {
  validateFields(input, BEGIN_FIELDS);
  if (!EVENT_KINDS.includes(input?.kind)) throw new Error("unsupported delivery telemetry kind");
  const clock = clockFrom(options);
  const token = boundedIdentifier(
    options.token || crypto.randomBytes(16).toString("hex"),
    "segment token",
    true
  );
  const processId = boundedIdentifier(options.processId || PROCESS_ID, "process id", true);
  const segment = {
    token,
    process_id: processId,
    kind: input.kind,
    app: boundedIdentifier(input.app, "app"),
    route: boundedIdentifier(input.route, "route"),
    artifact_identity: boundedIdentifier(input.artifact_identity, "artifact identity"),
    delivery_id: boundedIdentifier(input.delivery_id, "delivery id"),
    started_at: clock.wall().toISOString(),
    monotonic_start_ns: clock.monotonic().toString(),
  };
  mutateLedger(filePath, (ledger) => {
    if (ledger.open_segments.some((row) => row.token === token))
      throw new Error("delivery telemetry segment token already exists");
    if (ledger.open_segments.length >= MAX_OPEN_SEGMENTS)
      throw new Error("too many open delivery telemetry segments");
    ledger.open_segments.push(segment);
    ledger.open_segments.sort((left, right) => left.token.localeCompare(right.token));
  });
  return { token, process_id: processId };
}

function finishSegment(filePath, handle, result, options = {}) {
  validateFields(result, FINISH_FIELDS);
  if (!OUTCOMES.has(result?.outcome)) throw new Error("unsupported delivery telemetry outcome");
  if (
    result.certification_count !== undefined &&
    (!Number.isSafeInteger(result.certification_count) || result.certification_count < 0)
  )
    throw new Error("certification_count must be a nonnegative integer");
  const clock = clockFrom(options);
  return mutateLedger(filePath, (ledger) => {
    const index = ledger.open_segments.findIndex(
      (row) => row.token === handle?.token && row.process_id === handle?.process_id
    );
    if (index < 0) throw new Error("delivery telemetry segment is unavailable in this process");
    const [segment] = ledger.open_segments.splice(index, 1);
    const elapsed = clock.monotonic() - BigInt(segment.monotonic_start_ns);
    if (elapsed < 0n) throw new Error("monotonic delivery interval moved backwards");
    const event = closeEvent(segment, result, clock.wall().toISOString(), Number(elapsed) / 1e6);
    ledger.events.push(event);
    return event;
  });
}

function recoverInterruptedSegments(filePath, options = {}) {
  const currentProcess = boundedIdentifier(options.processId || PROCESS_ID, "process id", true);
  const wall = options.wall || (() => new Date());
  const isProcessAlive = options.isProcessAlive || processIsAlive;
  return mutateLedger(filePath, (ledger) => {
    const interrupted = [];
    const retained = [];
    for (const segment of ledger.open_segments) {
      if (
        segment.process_id === currentProcess ||
        isProcessAlive(processIdNumber(segment.process_id))
      )
        retained.push(segment);
      else interrupted.push(segment);
    }
    interrupted.sort((left, right) => left.token.localeCompare(right.token));
    ledger.open_segments = retained;
    for (const segment of interrupted)
      ledger.events.push(
        closeEvent(segment, { outcome: "interrupted" }, wall().toISOString(), null)
      );
    return { recovered: interrupted.length };
  });
}

function processIdNumber(processId) {
  const match = String(processId || "").match(/^(\d+)-/);
  return match ? Number(match[1]) : null;
}

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function closeEvent(segment, result, endedAt, durationMs) {
  return {
    sequence: 0,
    kind: segment.kind,
    app: segment.app,
    route: segment.route,
    artifact_identity: segment.artifact_identity,
    delivery_id: segment.delivery_id,
    started_at: segment.started_at,
    ended_at: endedAt,
    duration_ms: durationMs,
    outcome: result.outcome,
    certification_count: result.certification_count ?? 0,
  };
}

function compactLedger(ledger) {
  if (!ledger.compaction || typeof ledger.compaction !== "object")
    ledger.compaction = emptyLedger().compaction;
  const excess = Math.max(0, ledger.events.length - MAX_EVENTS);
  if (excess > 0) {
    const removed = ledger.events.splice(0, excess);
    ledger.compaction.dropped_events += removed.length;
    ledger.compaction.duration_ms = round(
      ledger.compaction.duration_ms +
        removed.reduce((sum, event) => sum + (Number(event.duration_ms) || 0), 0)
    );
    ledger.compaction.certification_count += removed.reduce(
      (sum, event) => sum + (event.certification_count || 0),
      0
    );
  }
  ledger.events.forEach((event, index) => {
    event.sequence = ledger.compaction.dropped_events + index + 1;
  });
  const serialized = JSON.stringify(ledger);
  if (Buffer.byteLength(serialized) > MAX_BYTES)
    throw new Error("bounded telemetry fields unexpectedly exceed one MiB");
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

module.exports = {
  EVENT_KINDS,
  MAX_BYTES,
  MAX_EVENTS,
  beginSegment,
  compactLedger,
  finishSegment,
  readLedger,
  recoverInterruptedSegments,
};
