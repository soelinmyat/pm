"use strict";

/**
 * Unified staleness thresholds for KB health monitoring.
 *
 * Bands: [0, FRESH_DAYS) fresh, [FRESH_DAYS, STALE_DAYS) aging, [STALE_DAYS, +inf) stale.
 *
 * Canonical source — server replicates these values independently.
 * See also: pm_server health endpoint (references this file).
 */

const FRESH_DAYS = 30;
const STALE_DAYS = 60;

/**
 * Classify a file's age in days.
 * @param {number} days — age in days (non-negative)
 * @returns {"fresh" | "aging" | "stale"}
 */
function classifyAge(days) {
  if (days < FRESH_DAYS) return "fresh";
  if (days < STALE_DAYS) return "aging";
  return "stale";
}

/**
 * Classify a file by its last-modified epoch timestamp.
 * @param {number} epochSecs — Unix timestamp in seconds
 * @returns {"fresh" | "aging" | "stale"}
 */
function classifyEpoch(epochSecs) {
  const nowSecs = Math.floor(Date.now() / 1000);
  const ageDays = Math.floor((nowSecs - epochSecs) / 86400);
  return classifyAge(ageDays);
}

module.exports = { FRESH_DAYS, STALE_DAYS, classifyAge, classifyEpoch };
