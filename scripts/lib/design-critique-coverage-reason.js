"use strict";

const { hasControlCharacter } = require("./evidence-schema");

// Capture and the checker share one rule. The Fresh Eyes prompt renders each
// reason verbatim as the last field of a one-line capture row, so a line break
// or other control character would split that row.
const MAX_COVERAGE_REASON_LENGTH = 2_000;

function coverageReasonIssue(value, { allowBlank }) {
  if (typeof value !== "string" || value.length > MAX_COVERAGE_REASON_LENGTH)
    return `must be a string of at most ${MAX_COVERAGE_REASON_LENGTH} characters`;
  if (hasControlCharacter(value)) return "must not contain control characters such as line breaks";
  if (!allowBlank && !value.trim()) return "must not be blank";
  return null;
}

module.exports = { MAX_COVERAGE_REASON_LENGTH, coverageReasonIssue };
