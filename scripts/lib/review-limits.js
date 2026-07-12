"use strict";

const MAX_JSON_BYTES = 4 * 1024 * 1024;
const MAX_HTML_BYTES = 4 * 1024 * 1024;
// Sum of current committed blob bytes permitted in one frozen Review inventory.
const MAX_CHANGED_FILE_BYTES = 64 * 1024 * 1024;
// The canonical HTML is a single, fully visible report whose complete render
// must pass artifact-render-check's 16,000px height budget. Bound both the card
// count and prose below; the browser render remains the authoritative layout gate.
const MAX_FINDINGS_PER_REVIEWER = 24;
const MAX_FINDINGS_PER_ROUND = 24;
// These fields are rendered verbatim into the human report. Bound both a single
// field and their aggregate so a small finding count cannot smuggle megabytes of
// wrapping prose past the cardinality limit.
const MAX_FINDING_PROSE_CHARS = 2_000;
const MAX_FINDING_RENDER_CHARS_PER_ROUND = 8_000;

module.exports = {
  MAX_CHANGED_FILE_BYTES,
  MAX_FINDING_PROSE_CHARS,
  MAX_FINDING_RENDER_CHARS_PER_ROUND,
  MAX_FINDINGS_PER_REVIEWER,
  MAX_FINDINGS_PER_ROUND,
  MAX_HTML_BYTES,
  MAX_JSON_BYTES,
};
