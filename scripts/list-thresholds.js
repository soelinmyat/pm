"use strict";

const HOUR = 3600;
const DAY = 24 * HOUR;

const STALENESS = Object.freeze({
  fresh: "fresh",
  default: "default",
  stale: "stale",
  cold: "cold",
});

// Boundary policy (documented):
//   ageSecs <  24h        -> "fresh"
//   24h    <= ageSecs < 7d  -> "default"
//   7d     <= ageSecs < 30d -> "stale"
//   30d    <= ageSecs       -> "cold"
// Future timestamps (ageSecs < 0) collapse to "fresh".
function classifyListAge(epochSecs, now) {
  const nowSecs = typeof now === "number" ? now : Math.floor(Date.now() / 1000);
  const ageSecs = nowSecs - epochSecs;

  if (ageSecs < DAY) return STALENESS.fresh;
  if (ageSecs < 7 * DAY) return STALENESS.default;
  if (ageSecs < 30 * DAY) return STALENESS.stale;
  return STALENESS.cold;
}

module.exports = { classifyListAge, STALENESS };
