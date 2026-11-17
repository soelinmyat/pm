"use strict";

// Shared by both producers and the final checker. The checker adds the
// route-dependent capture, evidence, prose and chronology constraints.
const FINDING_EXAMPLE = Object.freeze({
  subject_id: "account-detail",
  region: "actions",
  rule: "pending-label",
  coverage_ids: ["account-loading"],
  evidence_ids: ["capture-account-loading"],
  priority: "P2",
  owner: "design-critique",
  basis: "craft",
  confidence: "high",
  summary: "The Save button loses its visible label while saving.",
  impact: "People can see activity but lose the action's label.",
  remediation: "Keep the Save label alongside the progress indicator.",
});
const FINDING_FIELDS = Object.freeze(Object.keys(FINDING_EXAMPLE));
const FINDING_ENUMS = Object.freeze({
  owner: Object.freeze(["design-critique", "qa", "review"]),
  basis: Object.freeze(["objective", "craft", "uncertain"]),
  confidence: Object.freeze(["high", "medium", "low"]),
});
const PRIORITIES = Object.freeze({
  primary: Object.freeze(["P0", "P1", "P2", "P3"]),
  "fresh-eyes": Object.freeze(["P0", "P1", "P2"]),
});
const CORRECTABLE_ENUMS = Object.freeze(["owner", "basis"]);

function findingEnums(perspective) {
  if (!Object.hasOwn(PRIORITIES, perspective)) throw new Error("unknown design reviewer");
  return { priority: PRIORITIES[perspective], ...FINDING_ENUMS };
}

function findingVocabulary(perspective) {
  return [
    "Finding enum values:",
    ...Object.entries(findingEnums(perspective)).map(([field, values]) => {
      return `- ${field}: ${values.map((value) => JSON.stringify(value)).join(", ")}`;
    }),
    "",
    "Example finding (illustrative only; use your own evidence and judgment):",
    JSON.stringify(FINDING_EXAMPLE, null, 2),
  ].join("\n");
}

module.exports = { CORRECTABLE_ENUMS, FINDING_FIELDS, findingEnums, findingVocabulary };
