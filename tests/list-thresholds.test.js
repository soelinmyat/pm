"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { classifyListAge, STALENESS } = require("../scripts/list-thresholds");

const NOW = Math.floor(Date.parse("2026-04-17T00:00:00Z") / 1000);
const HOUR = 3600;
const DAY = 24 * HOUR;

test("STALENESS enumerates the four documented tiers", () => {
  assert.deepEqual(Object.keys(STALENESS).sort(), ["cold", "default", "fresh", "stale"]);
  for (const tier of Object.values(STALENESS)) {
    assert.equal(typeof tier, "string");
  }
});

test("classifyListAge returns 'fresh' for ages strictly under 24h", () => {
  assert.equal(classifyListAge(NOW - (HOUR - 1), NOW), "fresh");
  assert.equal(classifyListAge(NOW - 12 * HOUR, NOW), "fresh");
  assert.equal(classifyListAge(NOW - (DAY - 1), NOW), "fresh");
});

test("classifyListAge returns 'default' at the 24h boundary and up to just under 7d", () => {
  assert.equal(classifyListAge(NOW - DAY, NOW), "default", "24h exactly is 'default'");
  assert.equal(classifyListAge(NOW - 3 * DAY, NOW), "default");
  assert.equal(classifyListAge(NOW - (7 * DAY - 1), NOW), "default");
});

test("classifyListAge returns 'stale' at the 7d boundary and up to just under 30d", () => {
  assert.equal(classifyListAge(NOW - 7 * DAY, NOW), "stale", "7d exactly is 'stale'");
  assert.equal(classifyListAge(NOW - 14 * DAY, NOW), "stale");
  assert.equal(classifyListAge(NOW - (30 * DAY - 1), NOW), "stale");
});

test("classifyListAge returns 'cold' at the 30d boundary and beyond", () => {
  assert.equal(classifyListAge(NOW - 30 * DAY, NOW), "cold", "30d exactly is 'cold'");
  assert.equal(classifyListAge(NOW - 90 * DAY, NOW), "cold");
  assert.equal(classifyListAge(NOW - 365 * DAY, NOW), "cold");
});

test("classifyListAge treats future timestamps as 'fresh'", () => {
  assert.equal(classifyListAge(NOW + HOUR, NOW), "fresh");
});

test("classifyListAge defaults now to Date.now() when omitted", () => {
  // Only assert the function runs and returns a known tier — we can't pin real time.
  const tier = classifyListAge(Math.floor(Date.now() / 1000));
  assert.ok(["fresh", "default", "stale", "cold"].includes(tier));
});
