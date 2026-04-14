"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  FRESH_DAYS,
  STALE_DAYS,
  classifyAge,
  classifyEpoch,
} = require("../scripts/kb-health-thresholds.js");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

test("FRESH_DAYS is 30", () => {
  assert.equal(FRESH_DAYS, 30);
});

test("STALE_DAYS is 60", () => {
  assert.equal(STALE_DAYS, 60);
});

// ---------------------------------------------------------------------------
// classifyAge — boundary values
// ---------------------------------------------------------------------------

test("classifyAge(0) returns fresh", () => {
  assert.equal(classifyAge(0), "fresh");
});

test("classifyAge(29) returns fresh", () => {
  assert.equal(classifyAge(29), "fresh");
});

test("classifyAge(30) returns aging", () => {
  assert.equal(classifyAge(30), "aging");
});

test("classifyAge(59) returns aging", () => {
  assert.equal(classifyAge(59), "aging");
});

test("classifyAge(60) returns stale", () => {
  assert.equal(classifyAge(60), "stale");
});

test("classifyAge(61) returns stale", () => {
  assert.equal(classifyAge(61), "stale");
});

test("classifyAge(365) returns stale", () => {
  assert.equal(classifyAge(365), "stale");
});

// ---------------------------------------------------------------------------
// classifyEpoch — delegates to classifyAge using current time
// ---------------------------------------------------------------------------

test("classifyEpoch for a recent timestamp returns fresh", () => {
  const nowSecs = Math.floor(Date.now() / 1000);
  const tenDaysAgo = nowSecs - 10 * 86400;
  assert.equal(classifyEpoch(tenDaysAgo), "fresh");
});

test("classifyEpoch for a 45-day-old timestamp returns aging", () => {
  const nowSecs = Math.floor(Date.now() / 1000);
  const fortyFiveDaysAgo = nowSecs - 45 * 86400;
  assert.equal(classifyEpoch(fortyFiveDaysAgo), "aging");
});

test("classifyEpoch for a 90-day-old timestamp returns stale", () => {
  const nowSecs = Math.floor(Date.now() / 1000);
  const ninetyDaysAgo = nowSecs - 90 * 86400;
  assert.equal(classifyEpoch(ninetyDaysAgo), "stale");
});
